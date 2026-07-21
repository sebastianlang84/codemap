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
        if (typeof event.command !== "string" || typeof event.ts !== "string") {
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
        repos.add(repoOf(event));
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
        const repo = repoOf(event);
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
            if (!notApprovedTs.has(repo) || ms < notApprovedTs.get(repo))
                notApprovedTs.set(repo, ms);
        }
        if (event.command === "index" && event.approve === true) {
            if (!approveTs.has(repo) || ms < approveTs.get(repo))
                approveTs.set(repo, ms);
        }
        if (event.command === "search") {
            (searchTs.get(repo) ?? searchTs.set(repo, []).get(repo)).push(ms);
        }
    }
    let approvedAfterGate = 0;
    let searchedAfterApprove = 0;
    for (const [repo, gateMs] of notApprovedTs) {
        const approvedMs = approveTs.get(repo);
        if (approvedMs === undefined || !(approvedMs >= gateMs))
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
    const searches = events.filter((event) => event.command === "search" && Array.isArray(event.results));
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
        const contextMs = tsMs(event);
        const inWindow = searches.filter((search) => {
            if (repoOf(search) !== repo)
                return false;
            const ms = tsMs(search);
            return ms <= contextMs && ms >= contextMs - windowMs;
        });
        if (inWindow.length === 0) {
            unjoinable++;
            continue;
        }
        // Prefer a search from the same agent (ppid_chain) when available; otherwise any in-window search.
        const sameChain = event.agent?.ppid_chain
            ? inWindow.filter((search) => search.agent?.ppid_chain === event.agent.ppid_chain)
            : [];
        const pool = sameChain.length > 0 ? sameChain : inWindow;
        const nearest = pool.reduce((best, search) => (tsMs(search) >= tsMs(best) ? search : best));
        const rank = (nearest.results ?? []).findIndex((row) => row.path === event.resolved_path) + 1;
        if (rank > 0) {
            joined++;
            ranks.push(rank);
            bump(rankHistogram, String(rank));
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
        rankHistogram: sortedRecord(rankHistogram),
        topRankHits: rankHistogram["1"] ?? 0,
        meanRank: ranks.length === 0 ? null : round(ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length, 2),
    };
}
// --- helpers -----------------------------------------------------------------------------------------
function repoOf(event) {
    return event.repo_key ?? event.repo_root ?? NO_REPO;
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
