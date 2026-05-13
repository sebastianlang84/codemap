import { snippet } from "./chunker.ts";
import { openRepoDb } from "./db.ts";
import { status } from "./indexer.ts";
import { getRepoInfo } from "./repo.ts";
import { searchCodeMap } from "./search.ts";
import { normalizePathPrefix } from "./scanner.ts";
import type { SearchResult } from "./types.ts";

export interface CodeMapContextOptions {
  target: string;
  cwd?: string;
  limit?: number;
  pathPrefix?: string;
}

export interface CodeMapReadFirstChunk {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  text: string;
  snippet: string;
}

export type CodeMapReadFirstItem = CodeMapReadFirstChunk | SearchResult;

export interface CodeMapContextPackage {
  target: string;
  root: string;
  pathPrefix: string;
  lastIndexedAt: string | null;
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  readFirst: CodeMapReadFirstItem[];
  relatedTests: string[];
  relatedDocs: string[];
  warnings: string[];
}

interface ContextDiagnostics {
  stale?: boolean;
  changed?: number;
  missing?: number;
  deleted?: number;
  warnings?: string[];
}

export function buildCodeMapContext(options: CodeMapContextOptions): CodeMapContextPackage {
  const info = getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  try {
    const request = normalizeContextRequest(options);
    const diagnostics = status(options.cwd, { health: "full", pathPrefix: request.pathPrefix }) as ContextDiagnostics;
    const warnings: string[] = [...(diagnostics.warnings ?? [])];
    const readFirst = readFirstItems(db, request, warnings, options.cwd);
    const related = relatedPaths(db, readFirst.base, request.pathFilter);
    const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;

    return {
      target: request.target,
      root: info.root,
      pathPrefix: request.pathPrefix,
      lastIndexedAt,
      stale: diagnostics.stale ?? false,
      changed: diagnostics.changed ?? 0,
      missing: diagnostics.missing ?? 0,
      deleted: diagnostics.deleted ?? 0,
      readFirst: readFirst.items,
      relatedTests: related.tests,
      relatedDocs: related.docs,
      warnings,
    };
  } finally {
    db.close();
  }
}

function normalizeContextRequest(options: CodeMapContextOptions) {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const target = options.target.trim();
  return {
    limit,
    pathPrefix,
    target,
    targetLike: `%${escapeLike(target)}%`,
    pathFilter: pathPrefix ? `${escapeLike(pathPrefix)}%` : "%",
  };
}

function readFirstItems(
  db: ReturnType<typeof openRepoDb>,
  request: ReturnType<typeof normalizeContextRequest>,
  warnings: string[],
  cwd?: string,
): { base: string; items: CodeMapReadFirstItem[] } {
  const file = db.prepare("select id, path, language from files where (path = ? or path like ? escape '\\') and path like ? escape '\\' limit 1")
    .get(request.target, request.targetLike, request.pathFilter) as { id: number; path: string; language: string } | undefined;

  if (!file) {
    warnings.push("Target was not an indexed file path; falling back to search results.");
    return {
      base: request.target,
      items: searchCodeMap({ query: request.target, cwd, limit: request.limit, pathPrefix: request.pathPrefix }),
    };
  }

  const chunks = db.prepare("select start_line as startLine, end_line as endLine, kind, text from chunks where file_id=? order by ordinal limit ?")
    .all(file.id, Math.min(request.limit, 6)) as Array<{ startLine: number; endLine: number; kind: string; text: string }>;
  return {
    base: file.path,
    items: chunks.map((chunk) => ({ path: file.path, language: file.language, ...chunk, snippet: snippet(chunk.text) })),
  };
}

function relatedPaths(db: ReturnType<typeof openRepoDb>, base: string, pathFilter: string): { tests: string[]; docs: string[] } {
  const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "") ?? base;
  const stemLike = `%${escapeLike(stem)}%`;
  const baseLike = `%${escapeLike(base)}%`;
  const relatedTests = db.prepare(`
    select path from files
    where (path like '%test%' or path like '%spec%') and (path like ? escape '\\' or path like ? escape '\\') and path like ? escape '\\'
    order by path limit 8
  `).all(stemLike, baseLike, pathFilter) as Array<{ path: string }>;
  const relatedDocs = db.prepare(`
    select path from files
    where language = 'markdown' and (path like ? escape '\\' or path like ? escape '\\') and path like ? escape '\\'
    order by path limit 8
  `).all(stemLike, baseLike, pathFilter) as Array<{ path: string }>;
  return { tests: relatedTests.map((r) => r.path), docs: relatedDocs.map((r) => r.path) };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
