import { openRepoDb } from "./db.ts";
import { getRepoInfo, type StateOptions } from "./repo.ts";
import { status } from "./indexer.ts";
import { planQuery } from "./query-plan.ts";
import { rankAndSlice, topHitConfidence, type SearchScoreDiagnostics, type TopHitConfidence } from "./ranking.ts";
import { collectSearchCandidateDiagnostics, collectSearchCandidates, pathFilterForPrefix, type SearchCandidateDiagnostic, type SearchCandidateSource } from "./search-pipeline.ts";
import { normalizePathPrefix } from "./scanner.ts";
import { NotApprovedError } from "./errors.ts";
import type { SearchResult } from "./types.ts";

interface SearchDiagnostics {
  stale?: boolean;
  changed?: number;
  missing?: number;
  deleted?: number;
  lastIndexedAt?: string | null;
  warnings?: string[];
}

// The measured agent-navigation budget is five files. Preserve that ranking as the stable prefix;
// wider requests may add candidates but never reorder the default read budget.
const STABLE_SEARCH_PREFIX = 5;
const MAX_SEARCH_LIMIT = 50;

export interface CodeMapSearchPackage {
  query: string;
  root: string;
  pathPrefix: string;
  lastIndexedAt: string | null;
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  warnings: string[];
  results: SearchResult[];
  topHitConfidence: TopHitConfidence;
}

export type SearchCandidateDecision = "selected" | "outside_limit" | "deduped_lower_score" | "non_positive_score";

export interface SearchCandidateDebugDiagnostic {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  source: SearchCandidateSource;
  score: number;
  decision: SearchCandidateDecision;
  selectedRank?: number;
  scoreDiagnostics: SearchScoreDiagnostics;
}

export interface CodeMapSearchDebugReport {
  query: string;
  root: string;
  pathPrefix: string;
  limit: number;
  results: SearchResult[];
  candidates: SearchCandidateDebugDiagnostic[];
}

export function searchCodeMapWithDiagnostics(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string } & StateOptions): CodeMapSearchPackage {
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  // Cheap Git health checks HEAD plus Git-visible indexable changes without hashing the repo.
  // Search staleness is advisory; file-level counts stay behind codemap_status --full.
  const diagnostics = status(options.cwd, { health: "cheap", pathPrefix, stateDir: options.stateDir }) as SearchDiagnostics & { root: string };
  const results = searchCodeMap({ ...options, pathPrefix });
  return {
    query: options.query,
    root: diagnostics.root,
    pathPrefix,
    lastIndexedAt: diagnostics.lastIndexedAt ?? null,
    stale: diagnostics.stale ?? false,
    changed: diagnostics.changed ?? 0,
    missing: diagnostics.missing ?? 0,
    deleted: diagnostics.deleted ?? 0,
    warnings: diagnostics.warnings ?? [],
    results,
    topHitConfidence: topHitConfidence(results),
  };
}

export function searchCodeMap(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string } & StateOptions): SearchResult[] {
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new NotApprovedError();
  const db = openRepoDb(info.dbPath);
  const limit = normalizedLimit(options.limit);
  const plan = planQuery(options.query);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);

  try {
    return stableSearchResults(db, plan, pathFilterForPrefix(pathPrefix), limit);
  } finally {
    db.close();
  }
}

export function searchCodeMapDebug(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string } & StateOptions): CodeMapSearchDebugReport {
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new NotApprovedError();
  const db = openRepoDb(info.dbPath);
  const limit = normalizedLimit(options.limit);
  const plan = planQuery(options.query);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);

  try {
    const prefixCandidates = collectSearchCandidateDiagnostics(db, { plan, limit: STABLE_SEARCH_PREFIX, pathFilter: pathFilterForPrefix(pathPrefix) });
    const expandedCandidates = limit <= STABLE_SEARCH_PREFIX
      ? prefixCandidates
      : collectSearchCandidateDiagnostics(db, { plan, limit: MAX_SEARCH_LIMIT, pathFilter: pathFilterForPrefix(pathPrefix) });
    const candidates = mergeCandidateDiagnostics(prefixCandidates, expandedCandidates);
    const results = stableResultsFromCandidates(prefixCandidates, expandedCandidates, limit);
    const bestCandidateByPath = candidateMapForResults(candidates, results);
    const selectedRanks = selectedCandidateRanks(results, bestCandidateByPath);
    return {
      query: options.query,
      root: info.root,
      pathPrefix,
      limit,
      results,
      candidates: candidates.map((candidate) => ({
        path: candidate.result.path,
        language: candidate.result.language,
        startLine: candidate.result.startLine,
        endLine: candidate.result.endLine,
        kind: candidate.result.kind,
        source: candidate.source,
        score: candidate.result.score,
        decision: candidateDecision(candidate, selectedRanks, bestCandidateByPath),
        selectedRank: selectedRanks.get(candidate),
        scoreDiagnostics: candidate.scoreDiagnostics,
      })),
    };
  } finally {
    db.close();
  }
}

function mergeCandidateDiagnostics(prefix: SearchCandidateDiagnostic[], expanded: SearchCandidateDiagnostic[]): SearchCandidateDiagnostic[] {
  const merged = new Map<string, SearchCandidateDiagnostic>();
  for (const candidate of [...prefix, ...expanded]) {
    const key = [candidate.source, candidate.result.path, candidate.result.startLine, candidate.result.endLine, candidate.result.kind, candidate.result.score].join("\0");
    if (!merged.has(key)) merged.set(key, candidate);
  }
  return [...merged.values()];
}

function normalizedLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), MAX_SEARCH_LIMIT);
}

function stableSearchResults(
  db: ReturnType<typeof openRepoDb>,
  plan: ReturnType<typeof planQuery>,
  pathFilter: string,
  limit: number,
): SearchResult[] {
  const prefix = collectSearchCandidates(db, { plan, limit: STABLE_SEARCH_PREFIX, pathFilter });
  if (limit <= STABLE_SEARCH_PREFIX) return rankAndSlice(prefix, STABLE_SEARCH_PREFIX).slice(0, limit);
  const expanded = collectSearchCandidates(db, { plan, limit: MAX_SEARCH_LIMIT, pathFilter });
  return stableResultsFromCandidates(prefix, expanded, limit);
}

function stableResultsFromCandidates(
  prefixCandidates: SearchResult[] | SearchCandidateDiagnostic[],
  expandedCandidates: SearchResult[] | SearchCandidateDiagnostic[],
  limit: number,
): SearchResult[] {
  const resultsOf = (items: SearchResult[] | SearchCandidateDiagnostic[]) => items.map((item) => "result" in item ? item.result : item);
  const prefix = rankAndSlice(resultsOf(prefixCandidates), STABLE_SEARCH_PREFIX);
  const seen = new Set(prefix.map((result) => result.path));
  const expanded = rankAndSlice(resultsOf(expandedCandidates), MAX_SEARCH_LIMIT).filter((result) => !seen.has(result.path));
  return [...prefix, ...expanded].slice(0, limit);
}

function selectedCandidateRanks(results: SearchResult[], bestCandidateByPath: Map<string, SearchCandidateDiagnostic>): Map<SearchCandidateDiagnostic, number> {
  const ranks = new Map<SearchCandidateDiagnostic, number>();
  results.forEach((result, index) => {
    const candidate = bestCandidateByPath.get(result.path);
    if (candidate) ranks.set(candidate, index + 1);
  });
  return ranks;
}

function candidateMapForResults(candidates: SearchCandidateDiagnostic[], results: SearchResult[]): Map<string, SearchCandidateDiagnostic> {
  const byPath = new Map<string, SearchCandidateDiagnostic>();
  for (const result of results) {
    const exact = candidates.find((candidate) => candidate.result.path === result.path && candidate.result.score === result.score);
    const fallback = candidates.filter((candidate) => candidate.result.path === result.path)
      .sort((left, right) => right.result.score - left.result.score)[0];
    if (exact ?? fallback) byPath.set(result.path, (exact ?? fallback)!);
  }
  return byPath;
}

function candidateDecision(candidate: SearchCandidateDiagnostic, selectedRanks: Map<SearchCandidateDiagnostic, number>, bestCandidateByPath: Map<string, SearchCandidateDiagnostic>): SearchCandidateDecision {
  if (selectedRanks.has(candidate)) return "selected";
  if (candidate.result.score <= 0) return "non_positive_score";
  if (bestCandidateByPath.get(candidate.result.path) !== candidate) return "deduped_lower_score";
  return "outside_limit";
}
