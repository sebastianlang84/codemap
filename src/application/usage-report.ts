// Offline analyzer for the append-only usage telemetry (ADR 0001 phase 2).
//
// Pure and I/O-free: it takes already-read JSONL lines and returns a deterministic report object.
// It never reads the log itself and is never imported by a codeMap* path, so the "write-only, never
// read back into ranking" invariant of ./telemetry.ts is preserved — this module only consumes an
// export a human or the report script hands it. All aggregation tolerates missing/legacy fields:
// nothing here throws on a malformed or partial event (those are counted, never fatal).

// Superset of every field the seam writes (see ./telemetry.ts + ./operations.ts). All optional beyond
// the envelope basics — additive schema, so older events simply omit newer fields.
export interface UsageEvent {
  v?: number;
  ts?: string;
  tool_version?: string;
  command?: string;
  adapter?: string;
  latency_ms?: number;
  outcome?: string;
  repo_key?: string;
  repo_root?: string;
  cwd?: string;
  path_prefix?: string;
  error_kind?: string;
  agent?: { ppid_chain?: string; harness?: string; session?: string };
  // search
  query?: string;
  result_count?: number;
  top_score?: number;
  top_hit_confidence?: string;
  stale?: boolean;
  cap_hit?: boolean;
  results?: Array<{ path?: string; score?: number; kind?: string; language?: string }>;
  // context
  target?: string;
  target_form?: string;
  resolved_path?: string;
  read_first_count?: number;
  // index
  approve?: boolean;
  duration_ms?: number;
  scanned?: number;
  indexed?: number;
  skipped?: number;
  removed?: number;
}

export interface ParsedUsage {
  events: UsageEvent[];
  /** Non-blank lines that failed JSON.parse or lacked a string ts/command (half-written on kill). */
  malformedLines: number;
}

export interface BuildUsageReportOptions {
  /** Join window for stale→refresh and search→context correlation. Default 15 minutes. */
  joinWindowMs?: number;
  /** Malformed-line count from parseUsageLines, surfaced in the overview. */
  malformedLines?: number;
}

const DEFAULT_JOIN_WINDOW_MS = 15 * 60 * 1000;
const NO_REPO = "(no repo)";

/** Parse raw JSONL lines; blank lines are ignored, bad lines counted, never thrown. */
export function parseUsageLines(lines: string[]): ParsedUsage {
  const events: UsageEvent[] = [];
  let malformedLines = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      malformedLines++;
      continue;
    }
    const event = parsed as UsageEvent;
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

// --- Report shape ------------------------------------------------------------------------------------

export interface UsageOverview {
  totalEvents: number;
  malformedLines: number;
  firstEvent?: string;
  lastEvent?: string;
  distinctRepos: number;
  distinctAgents: number;
  byCommand: Record<string, number>;
  byAdapter: Record<string, number>;
  byHarness: Record<string, number>;
  byToolVersion: Record<string, number>;
}

export interface RepoUsage {
  repo: string;
  byCommand: Record<string, number>;
  byDay: Record<string, number>;
  lastActivity?: string;
}

export interface CommandOutcomes {
  command: string;
  total: number;
  byOutcome: Record<string, number>;
  errorKinds: Record<string, number>;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  /** search only */
  search?: {
    emptyRate: number;
    capHitRate: number;
    staleRate: number;
    topScoreP50: number | null;
    topHitConfidence: Record<string, number>;
  };
  /** index only */
  index?: {
    approveRate: number;
    durationMsP50: number | null;
    durationMsP95: number | null;
  };
}

export interface GateFunnel {
  /** Repos that ever hit a not_approved gate. */
  notApprovedRepos: number;
  /** Raw not_approved event count (a repo may hit the gate repeatedly). */
  notApprovedEvents: number;
  /** Of notApprovedRepos, how many later ran an approving index. */
  approvedAfterGate: number;
  /** Of approvedAfterGate, how many later ran a search. */
  searchedAfterApprove: number;
}

export interface StaleRefresh {
  staleSearches: number;
  /** Stale searches followed by an index in the same repo within the join window. */
  refreshedWithinWindow: number;
  /** Of those refreshed, how many were followed by another search after the refresh. */
  reSearchedAfterRefresh: number;
}

export interface SearchContextJoin {
  /** context events resolved to a concrete file (target_form=path with resolved_path). */
  pathContexts: number;
  /** context events used as another query (target_form=query). */
  queryContexts: number;
  /** path contexts whose resolved file appeared in a prior search's impressions within the window. */
  joined: number;
  /** path contexts with a prior search in-window but the file was NOT among its impressions. */
  recoveredMisses: number;
  /** path contexts with no prior in-window search to join against. */
  unjoinable: number;
  /** rank (1-based) histogram of joined hits. */
  rankHistogram: Record<string, number>;
  /** joined hits at rank 1. */
  topRankHits: number;
  meanRank: number | null;
}

export interface UsageReport {
  overview: UsageOverview;
  perRepo: RepoUsage[];
  outcomes: CommandOutcomes[];
  gateFunnel: GateFunnel;
  staleRefresh: StaleRefresh;
  searchContextJoin: SearchContextJoin;
  joinWindowMs: number;
}

// --- Builder -----------------------------------------------------------------------------------------

export function buildUsageReport(events: UsageEvent[], options: BuildUsageReportOptions = {}): UsageReport {
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

function buildOverview(events: UsageEvent[], malformedLines: number): UsageOverview {
  const repos = new Set<string>();
  const agents = new Set<string>();
  const byCommand: Record<string, number> = {};
  const byAdapter: Record<string, number> = {};
  const byHarness: Record<string, number> = {};
  const byToolVersion: Record<string, number> = {};
  let first: number | undefined;
  let last: number | undefined;
  for (const event of events) {
    repos.add(repoOf(event));
    if (event.agent?.ppid_chain) agents.add(event.agent.ppid_chain);
    bump(byCommand, event.command ?? "(unknown)");
    bump(byAdapter, event.adapter ?? "unknown");
    if (event.agent?.harness) bump(byHarness, event.agent.harness);
    bump(byToolVersion, event.tool_version ?? "(unknown)");
    const ms = tsMs(event);
    if (Number.isFinite(ms)) {
      if (first === undefined || ms < first) first = ms;
      if (last === undefined || ms > last) last = ms;
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

function buildPerRepo(events: UsageEvent[]): RepoUsage[] {
  const byRepo = new Map<string, RepoUsage>();
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
      if (!entry.lastActivity || event.ts > entry.lastActivity) entry.lastActivity = event.ts;
    }
  }
  return [...byRepo.values()]
    .map((entry) => ({ ...entry, byCommand: sortedRecord(entry.byCommand), byDay: sortedRecord(entry.byDay) }))
    .sort((a, b) => total(b.byCommand) - total(a.byCommand) || a.repo.localeCompare(b.repo));
}

function buildOutcomes(events: UsageEvent[]): CommandOutcomes[] {
  const byCommand = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const command = event.command ?? "(unknown)";
    (byCommand.get(command) ?? byCommand.set(command, []).get(command)!).push(event);
  }
  const commands = [...byCommand.keys()].sort();
  return commands.map((command) => {
    const group = byCommand.get(command)!;
    const byOutcome: Record<string, number> = {};
    const errorKinds: Record<string, number> = {};
    for (const event of group) {
      bump(byOutcome, event.outcome ?? "(unknown)");
      if (event.error_kind) bump(errorKinds, event.error_kind);
    }
    const latencies = numbers(group.map((event) => event.latency_ms));
    const result: CommandOutcomes = {
      command,
      total: group.length,
      byOutcome: sortedRecord(byOutcome),
      errorKinds: sortedRecord(errorKinds),
      latencyMsP50: percentile(latencies, 50),
      latencyMsP95: percentile(latencies, 95),
    };
    if (command === "search") {
      const confidence: Record<string, number> = {};
      for (const event of group) if (event.top_hit_confidence) bump(confidence, event.top_hit_confidence);
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

function buildGateFunnel(events: UsageEvent[]): GateFunnel {
  // Per repo, the timeline of the three gate stages. "later" is by timestamp within the same repo.
  const notApprovedTs = new Map<string, number>();
  const approveTs = new Map<string, number>();
  const searchTs = new Map<string, number[]>();
  let notApprovedEvents = 0;
  for (const event of events) {
    const repo = repoOf(event);
    const ms = tsMs(event);
    if (event.outcome === "not_approved") {
      notApprovedEvents++;
      if (!notApprovedTs.has(repo) || ms < notApprovedTs.get(repo)!) notApprovedTs.set(repo, ms);
    }
    if (event.command === "index" && event.approve === true) {
      if (!approveTs.has(repo) || ms < approveTs.get(repo)!) approveTs.set(repo, ms);
    }
    if (event.command === "search") {
      (searchTs.get(repo) ?? searchTs.set(repo, []).get(repo)!).push(ms);
    }
  }
  let approvedAfterGate = 0;
  let searchedAfterApprove = 0;
  for (const [repo, gateMs] of notApprovedTs) {
    const approvedMs = approveTs.get(repo);
    if (approvedMs === undefined || !(approvedMs >= gateMs)) continue;
    approvedAfterGate++;
    if ((searchTs.get(repo) ?? []).some((ms) => ms >= approvedMs)) searchedAfterApprove++;
  }
  return {
    notApprovedRepos: notApprovedTs.size,
    notApprovedEvents,
    approvedAfterGate,
    searchedAfterApprove,
  };
}

function buildStaleRefresh(events: UsageEvent[], windowMs: number): StaleRefresh {
  const indexTsByRepo = new Map<string, number[]>();
  const searchTsByRepo = new Map<string, number[]>();
  for (const event of events) {
    const repo = repoOf(event);
    const ms = tsMs(event);
    if (event.command === "index") (indexTsByRepo.get(repo) ?? indexTsByRepo.set(repo, []).get(repo)!).push(ms);
    if (event.command === "search") (searchTsByRepo.get(repo) ?? searchTsByRepo.set(repo, []).get(repo)!).push(ms);
  }
  let staleSearches = 0;
  let refreshedWithinWindow = 0;
  let reSearchedAfterRefresh = 0;
  for (const event of events) {
    if (event.command !== "search" || event.stale !== true) continue;
    staleSearches++;
    const repo = repoOf(event);
    const searchMs = tsMs(event);
    const refresh = (indexTsByRepo.get(repo) ?? [])
      .filter((ms) => ms >= searchMs && ms <= searchMs + windowMs)
      .sort((a, b) => a - b)[0];
    if (refresh === undefined) continue;
    refreshedWithinWindow++;
    if ((searchTsByRepo.get(repo) ?? []).some((ms) => ms > refresh && ms <= refresh + windowMs)) reSearchedAfterRefresh++;
  }
  return { staleSearches, refreshedWithinWindow, reSearchedAfterRefresh };
}

function buildSearchContextJoin(events: UsageEvent[], windowMs: number): SearchContextJoin {
  const searches = events.filter((event) => event.command === "search" && Array.isArray(event.results));
  let pathContexts = 0;
  let queryContexts = 0;
  let joined = 0;
  let recoveredMisses = 0;
  let unjoinable = 0;
  const rankHistogram: Record<string, number> = {};
  const ranks: number[] = [];
  for (const event of events) {
    if (event.command !== "context") continue;
    if (event.target_form === "query") {
      queryContexts++;
      continue;
    }
    if (event.target_form !== "path" || typeof event.resolved_path !== "string") continue;
    pathContexts++;
    const repo = repoOf(event);
    const contextMs = tsMs(event);
    const inWindow = searches.filter((search) => {
      if (repoOf(search) !== repo) return false;
      const ms = tsMs(search);
      return ms <= contextMs && ms >= contextMs - windowMs;
    });
    if (inWindow.length === 0) {
      unjoinable++;
      continue;
    }
    // Prefer a search from the same agent (ppid_chain) when available; otherwise any in-window search.
    const sameChain = event.agent?.ppid_chain
      ? inWindow.filter((search) => search.agent?.ppid_chain === event.agent!.ppid_chain)
      : [];
    const pool = sameChain.length > 0 ? sameChain : inWindow;
    const nearest = pool.reduce((best, search) => (tsMs(search) >= tsMs(best) ? search : best));
    const rank = (nearest.results ?? []).findIndex((row) => row.path === event.resolved_path) + 1;
    if (rank > 0) {
      joined++;
      ranks.push(rank);
      bump(rankHistogram, String(rank));
    } else {
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

function repoOf(event: UsageEvent): string {
  return event.repo_key ?? event.repo_root ?? NO_REPO;
}

function tsMs(event: UsageEvent): number {
  return typeof event.ts === "string" ? Date.parse(event.ts) : NaN;
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function total(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, count) => sum + count, 0);
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function numbers(values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function rate(events: UsageEvent[], predicate: (event: UsageEvent) => boolean): number {
  if (events.length === 0) return 0;
  return round(events.filter(predicate).length / events.length, 4);
}

/** Nearest-rank percentile over a copy of the values; null for an empty set. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
