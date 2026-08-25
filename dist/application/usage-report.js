// Offline analyzer for the append-only usage telemetry (ADR 0001 phase 2).
//
// Pure and I/O-free: it takes already-read JSONL lines and returns a deterministic report object.
// It never reads the log itself and is never imported by a codeMap* path, so the "write-only, never
// read back into ranking" invariant of ./telemetry.ts is preserved — this module only consumes an
// export a human or the report script hands it. All aggregation tolerates missing/legacy fields:
// nothing here throws on a malformed or partial event (those are counted, never fatal).
const DEFAULT_JOIN_WINDOW_MS = 15 * 60 * 1000;
const NO_REPO = "(no repo)";
/** Parse raw JSONL lines; blank lines are ignored, bad lines counted, never thrown. */
export function parseUsageLines(lines) {
    const events = [];
    let malformedLines = 0;
    for (const line of lines) {
        if (line.trim().length === 0)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            malformedLines++;
            continue;
        }
        if (typeof parsed !== "object" || parsed === null) {
            malformedLines++;
            continue;
        }
        const event = parsed;
        // A usable event needs at minimum a command and a parseable timestamp for the sequence analyses.
        if (typeof event.command !== "string" || typeof event.ts !== "string" || !Number.isFinite(Date.parse(event.ts))) {
            malformedLines++;
            continue;
        }
        events.push(event);
    }
    // Append log may interleave several processes; sort stably by timestamp for the sequence analyses.
    events.sort((a, b) => tsMs(a) - tsMs(b));
    return { events, malformedLines };
}
// --- Builder -----------------------------------------------------------------------------------------
export function buildUsageReport(events, options = {}) {
    const joinWindowMs = options.joinWindowMs ?? DEFAULT_JOIN_WINDOW_MS;
    return {
        overview: buildOverview(events, options.malformedLines ?? 0),
        perRepo: buildPerRepo(events),
        outcomes: buildOutcomes(events),
        gateFunnel: buildGateFunnel(events),
        staleRefresh: buildStaleRefresh(events, joinWindowMs),
        searchContextJoin: buildSearchContextJoin(events, joinWindowMs),
        joinWindowMs,
    };
}
/**
 * Remove every value that can identify a repository, path, query, process, session, or exact event
 * time. The raw JSONL remains private; this is the only report shape exposed by the installed CLI.
 */
export function anonymizeUsageReport(report) {
    const { overview } = report;
    return {
        reportVersion: 1,
        privacy: "aggregate",
        period: {
            firstDate: overview.firstEvent?.slice(0, 10),
            lastDate: overview.lastEvent?.slice(0, 10),
        },
        overview: {
            totalEvents: overview.totalEvents,
            malformedLines: overview.malformedLines,
            distinctRepos: overview.distinctRepos,
            byCommand: overview.byCommand,
            byAdapter: overview.byAdapter,
            byHarness: overview.byHarness,
            byToolVersion: overview.byToolVersion,
        },
        outcomes: report.outcomes,
        gateFunnel: report.gateFunnel,
        staleRefresh: report.staleRefresh,
        searchContextJoin: report.searchContextJoin,
        joinWindowMs: report.joinWindowMs,
    };
}
function buildOverview(events, malformedLines) {
    const repos = new Set();
    const agents = new Set();
    const byCommand = {};
    const byAdapter = {};
    const byHarness = {};
    const byToolVersion = {};
    let first;
    let last;
    for (const event of events) {
        const repo = repoOf(event);
        if (repo !== undefined)
            repos.add(repo);
        if (event.agent?.ppid_chain)
            agents.add(event.agent.ppid_chain);
        bump(byCommand, event.command ?? "(unknown)");
        bump(byAdapter, event.adapter ?? "unknown");
        if (event.agent?.harness)
            bump(byHarness, event.agent.harness);
        bump(byToolVersion, event.tool_version ?? "(unknown)");
        const ms = tsMs(event);
        if (Number.isFinite(ms)) {
            if (first === undefined || ms < first)
                first = ms;
            if (last === undefined || ms > last)
                last = ms;
        }
    }
    return {
        totalEvents: events.length,
        malformedLines,
        firstEvent: first === undefined ? undefined : new Date(first).toISOString(),
        lastEvent: last === undefined ? undefined : new Date(last).toISOString(),
        distinctRepos: repos.size,
        distinctAgents: agents.size,
        byCommand: sortedRecord(byCommand),
        byAdapter: sortedRecord(byAdapter),
        byHarness: sortedRecord(byHarness),
        byToolVersion: sortedRecord(byToolVersion),
    };
}
function buildPerRepo(events) {
    const byRepo = new Map();
    for (const event of events) {
        const repo = repoOf(event) ?? NO_REPO;
        let entry = byRepo.get(repo);
        if (!entry) {
            entry = { repo, byCommand: {}, byDay: {} };
            byRepo.set(repo, entry);
        }
        bump(entry.byCommand, event.command ?? "(unknown)");
        if (typeof event.ts === "string") {
            bump(entry.byDay, event.ts.slice(0, 10));
            if (!entry.lastActivity || event.ts > entry.lastActivity)
                entry.lastActivity = event.ts;
        }
    }
    return [...byRepo.values()]
        .map((entry) => ({ ...entry, byCommand: sortedRecord(entry.byCommand), byDay: sortedRecord(entry.byDay) }))
        .sort((a, b) => total(b.byCommand) - total(a.byCommand) || a.repo.localeCompare(b.repo));
}
function buildOutcomes(events) {
    const byCommand = new Map();
    for (const event of events) {
        const command = event.command ?? "(unknown)";
        (byCommand.get(command) ?? byCommand.set(command, []).get(command)).push(event);
    }
    const commands = [...byCommand.keys()].sort();
    return commands.map((command) => {
        const group = byCommand.get(command);
        const byOutcome = {};
        const errorKinds = {};
        for (const event of group) {
            bump(byOutcome, event.outcome ?? "(unknown)");
            if (event.error_kind)
                bump(errorKinds, event.error_kind);
        }
        const latencies = numbers(group.map((event) => event.latency_ms));
        const result = {
            command,
            total: group.length,
            byOutcome: sortedRecord(byOutcome),
            errorKinds: sortedRecord(errorKinds),
            latencyMsP50: percentile(latencies, 50),
            latencyMsP95: percentile(latencies, 95),
        };
        if (command === "search") {
            const confidence = {};
            for (const event of group)
                if (event.top_hit_confidence)
                    bump(confidence, event.top_hit_confidence);
            result.search = {
                emptyRate: rate(group, (event) => event.outcome === "empty"),
                capHitRate: rate(group, (event) => event.cap_hit === true),
                staleRate: rate(group, (event) => event.stale === true),
                topScoreP50: percentile(numbers(group.map((event) => event.top_score)), 50),
                topHitConfidence: sortedRecord(confidence),
            };
        }
        if (command === "index") {
            const durations = numbers(group.map((event) => event.duration_ms));
            result.index = {
                approveRate: rate(group, (event) => event.approve === true),
                durationMsP50: percentile(durations, 50),
                durationMsP95: percentile(durations, 95),
            };
        }
        return result;
    });
}
function buildGateFunnel(events) {
    // Per repo, the timeline of the three gate stages. "later" is by timestamp within the same repo.
    const notApprovedTs = new Map();
    const approveTs = new Map();
    const searchTs = new Map();
    let notApprovedEvents = 0;
    for (const event of events) {
        const repo = repoOf(event);
        const ms = tsMs(event);
        if (event.outcome === "not_approved") {
            notApprovedEvents++;
            if (repo === undefined)
                continue;
            if (!notApprovedTs.has(repo) || ms < notApprovedTs.get(repo))
                notApprovedTs.set(repo, ms);
        }
        if (repo === undefined)
            continue;
        if (event.command === "index" && event.approve === true) {
            (approveTs.get(repo) ?? approveTs.set(repo, []).get(repo)).push(ms);
        }
        if (event.command === "search") {
            (searchTs.get(repo) ?? searchTs.set(repo, []).get(repo)).push(ms);
        }
    }
    let approvedAfterGate = 0;
    let searchedAfterApprove = 0;
    for (const [repo, gateMs] of notApprovedTs) {
        const approvedMs = (approveTs.get(repo) ?? []).filter((ms) => ms >= gateMs).sort((a, b) => a - b)[0];
        if (approvedMs === undefined)
            continue;
        approvedAfterGate++;
        if ((searchTs.get(repo) ?? []).some((ms) => ms >= approvedMs))
            searchedAfterApprove++;
    }
    return {
        notApprovedRepos: notApprovedTs.size,
        notApprovedEvents,
        approvedAfterGate,
        searchedAfterApprove,
    };
}
function buildStaleRefresh(events, windowMs) {
    const indexTsByRepo = new Map();
    const searchTsByRepo = new Map();
    for (const event of events) {
        const repo = repoOf(event);
        const ms = tsMs(event);
        if (repo === undefined)
            continue;
        if (event.command === "index")
            (indexTsByRepo.get(repo) ?? indexTsByRepo.set(repo, []).get(repo)).push(ms);
        if (event.command === "search")
            (searchTsByRepo.get(repo) ?? searchTsByRepo.set(repo, []).get(repo)).push(ms);
    }
    let staleSearches = 0;
    let refreshedWithinWindow = 0;
    let reSearchedAfterRefresh = 0;
    for (const event of events) {
        if (event.command !== "search" || event.stale !== true)
            continue;
        staleSearches++;
        const repo = repoOf(event);
        if (repo === undefined)
            continue;
        const searchMs = tsMs(event);
        const refresh = (indexTsByRepo.get(repo) ?? [])
            .filter((ms) => ms >= searchMs && ms <= searchMs + windowMs)
            .sort((a, b) => a - b)[0];
        if (refresh === undefined)
            continue;
        refreshedWithinWindow++;
        if ((searchTsByRepo.get(repo) ?? []).some((ms) => ms > refresh && ms <= refresh + windowMs))
            reSearchedAfterRefresh++;
    }
    return { staleSearches, refreshedWithinWindow, reSearchedAfterRefresh };
}
function buildSearchContextJoin(events, windowMs) {
    const searchesByRepo = new Map();
    const searchesByAgent = new Map();
    const hitsByRepoPath = new Map();
    const hitsByAgentPath = new Map();
    for (const event of events) {
        if (event.command !== "search" || !Array.isArray(event.results))
            continue;
        const repo = repoOf(event);
        if (repo === undefined)
            continue;
        const ms = tsMs(event);
        appendTimed(searchesByRepo, repo, { ms });
        const chain = event.agent?.ppid_chain;
        if (chain)
            appendTimed(searchesByAgent, agentKey(repo, chain), { ms });
        const seen = new Set();
        for (let index = 0; index < event.results.length; index++) {
            const path = event.results[index]?.path;
            if (typeof path !== "string" || seen.has(path))
                continue;
            seen.add(path);
            appendTimed(hitsByRepoPath, repoPathKey(repo, path), { ms, rank: index + 1 });
            if (chain)
                appendTimed(hitsByAgentPath, agentPathKey(repo, chain, path), { ms, rank: index + 1 });
        }
    }
    for (const map of [searchesByRepo, searchesByAgent, hitsByRepoPath, hitsByAgentPath]) {
        for (const rows of map.values())
            rows.sort((a, b) => a.ms - b.ms);
    }
    let pathContexts = 0;
    let queryContexts = 0;
    let joined = 0;
    let recoveredMisses = 0;
    let unjoinable = 0;
    const rankHistogram = {};
    const ranks = [];
    for (const event of events) {
        if (event.command !== "context")
            continue;
        if (event.target_form === "query") {
            queryContexts++;
            continue;
        }
        if (event.target_form !== "path" || typeof event.resolved_path !== "string")
            continue;
        pathContexts++;
        const repo = repoOf(event);
        if (repo === undefined) {
            unjoinable++;
            continue;
        }
        const contextMs = tsMs(event);
        const startMs = contextMs - windowMs;
        const allSearches = searchesByRepo.get(repo) ?? [];
        const chain = event.agent?.ppid_chain;
        const agentSearches = chain ? (searchesByAgent.get(agentKey(repo, chain)) ?? []) : [];
        const useAgent = chain !== undefined && hasInWindow(agentSearches, startMs, contextMs);
        const pool = useAgent ? agentSearches : allSearches;
        if (!hasInWindow(pool, startMs, contextMs)) {
            unjoinable++;
            continue;
        }
        const hits = useAgent
            ? (hitsByAgentPath.get(agentPathKey(repo, chain, event.resolved_path)) ?? [])
            : (hitsByRepoPath.get(repoPathKey(repo, event.resolved_path)) ?? []);
        const hit = latestInWindow(hits, startMs, contextMs);
        if (hit) {
            joined++;
            ranks.push(hit.rank);
            bump(rankHistogram, String(hit.rank));
        }
        else {
            recoveredMisses++;
        }
    }
    return {
        pathContexts,
        queryContexts,
        joined,
        recoveredMisses,
        unjoinable,
        rankHistogram: numericKeyRecord(rankHistogram),
        topRankHits: rankHistogram["1"] ?? 0,
        meanRank: ranks.length === 0 ? null : round(ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length, 2),
    };
}
function appendTimed(map, key, value) {
    (map.get(key) ?? map.set(key, []).get(key)).push(value);
}
function hasInWindow(rows, startMs, endMs) {
    const index = lowerBoundMs(rows, startMs);
    return index < rows.length && rows[index].ms <= endMs;
}
function latestInWindow(rows, startMs, endMs) {
    const index = upperBoundMs(rows, endMs) - 1;
    return index >= 0 && rows[index].ms >= startMs ? rows[index] : undefined;
}
function upperBoundMs(rows, target) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (rows[middle].ms <= target)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}
function lowerBoundMs(rows, target) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (rows[middle].ms < target)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}
function agentKey(repo, chain) {
    return `${repo}\0${chain}`;
}
function repoPathKey(repo, path) {
    return `${repo}\0${path}`;
}
function agentPathKey(repo, chain, path) {
    return `${repo}\0${chain}\0${path}`;
}
// --- helpers -----------------------------------------------------------------------------------------
function repoOf(event) {
    return event.repo_key ?? event.repo_root;
}
function tsMs(event) {
    return typeof event.ts === "string" ? Date.parse(event.ts) : NaN;
}
function bump(record, key) {
    record[key] = (record[key] ?? 0) + 1;
}
function total(record) {
    return Object.values(record).reduce((sum, count) => sum + count, 0);
}
function sortedRecord(record) {
    return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
function numericKeyRecord(record) {
    return Object.fromEntries(Object.entries(record).sort((a, b) => Number(a[0]) - Number(b[0])));
}
function numbers(values) {
    return values.filter((value) => typeof value === "number" && Number.isFinite(value));
}
function rate(events, predicate) {
    if (events.length === 0)
        return 0;
    return round(events.filter(predicate).length / events.length, 4);
}
/** Nearest-rank percentile over a copy of the values; null for an empty set. */
function percentile(values, p) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}
function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
