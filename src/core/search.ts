import { openRepoDb } from "./db.ts";
import { getRepoInfo } from "./repo.ts";
import { status } from "./indexer.ts";
import { planQuery } from "./query-plan.ts";
import { fileRoleBoost, fileRoles, rankAndSlice, toResult, type SearchRow } from "./ranking.ts";
import { normalizePathPrefix } from "./scanner.ts";
import type { SearchResult } from "./types.ts";

interface SearchDiagnostics {
  stale?: boolean;
  changed?: number;
  missing?: number;
  deleted?: number;
  lastIndexedAt?: string | null;
  warnings?: string[];
}

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
}

export function searchCodeMapWithDiagnostics(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string }): CodeMapSearchPackage {
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const diagnostics = status(options.cwd, { health: "full", pathPrefix }) as SearchDiagnostics & { root: string };
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
    results: searchCodeMap({ ...options, pathPrefix }),
  };
}

export function searchCodeMap(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string }): SearchResult[] {
  const info = getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const plan = planQuery(options.query);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";

  try {
    const results: SearchResult[] = [];

    if (plan.pathLike) {
      const pathRows = db.prepare(`
        select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, null as symbolName
        from files
        where lower(path) like ? escape '\\' and path like ? escape '\\'
        order by length(path), path
        limit ?
      `).all(`%${escapeLike(plan.pathNeedle.toLowerCase())}%`, pathFilter, Math.min(limit, 20)) as unknown as SearchRow[];
      results.push(...pathRows.map((row) => toResult(row, plan, 30)));
    }

    if (plan.roleIntents.length > 0) {
      const roleRows = db.prepare(`
        select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, null as symbolName
        from files
        where path like ? escape '\\'
        order by length(path), path
        limit 500
      `).all(pathFilter) as unknown as SearchRow[];
      results.push(...roleRows
        .filter((row) => fileRoleBoost(fileRoles(row.path.toLowerCase()), plan.roleIntents) > 0)
        .map((row) => toResult(row, plan, 18)));
    }

    for (const ftsQuery of plan.ftsQueries) {
      const remaining = Math.max(limit * 2 - results.length, limit);
      const chunkRows = db.prepare(`
        select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
               bm25(chunks_fts) as rank, null as symbolName
        from chunks_fts
        join chunks c on c.id = chunks_fts.rowid
        join files f on f.id = c.file_id
        where chunks_fts match ? and f.path like ? escape '\\'
        order by rank
        limit ?
      `).all(ftsQuery.query, pathFilter, remaining) as unknown as SearchRow[];

      const symbolRows = db.prepare(`
        select f.path, f.language, s.start_line as startLine, coalesce(s.end_line, s.start_line) as endLine,
               s.kind, coalesce(s.signature, s.name) as text, bm25(symbols_fts) as rank, s.name as symbolName
        from symbols_fts
        join symbols s on s.id = symbols_fts.rowid
        join files f on f.id = s.file_id
        where symbols_fts match ? and f.path like ? escape '\\'
        order by rank
        limit ?
      `).all(ftsQuery.query, pathFilter, Math.ceil(remaining / 2)) as unknown as SearchRow[];

      results.push(...symbolRows.map((row) => toResult(row, plan, ftsQuery.tierBoost + 4)));
      results.push(...chunkRows.map((row) => toResult(row, plan, ftsQuery.tierBoost + 1)));
    }

    return rankAndSlice(results, limit);
  } finally {
    db.close();
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
