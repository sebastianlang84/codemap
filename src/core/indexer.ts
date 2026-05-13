import { openRepoDb } from "./db.ts";
import { applyIndexUpdate } from "./index-store.ts";
import { getRepoInfo, approveRepo } from "./repo.ts";
import { normalizePathPrefix, scanRepo } from "./scanner.ts";
import type { IndexStats } from "./types.ts";

const INDEX_VERSION = "3";

export function indexRepo(options: { cwd?: string; approve?: boolean; pathPrefix?: string } = {}): IndexStats & { dbPath: string; root: string; pathPrefix: string } {
  const info = options.approve ? approveRepo(options.cwd, "codemap_index") : getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved. Run codemap_index with approveRepo: true first.");
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const db = openRepoDb(info.dbPath);
  const scan = scanRepo(info.root, { pathPrefix });
  const indexVersionKey = pathPrefix ? `index_version:${pathPrefix}` : "index_version";
  const storedIndexVersion = (db.prepare("select value from meta where key=?").get(indexVersionKey) as { value: string } | undefined)?.value;
  const forceReindex = storedIndexVersion !== INDEX_VERSION;
  try {
    const update = applyIndexUpdate({ db, files: scan.files, pathPrefix, indexVersionKey, indexVersion: INDEX_VERSION, forceReindex });
    return { scanned: scan.files.length, indexed: update.indexed, skipped: scan.skipped, skippedReasons: scan.skippedReasons, removed: update.removed, warnings: scan.warnings, dbPath: info.dbPath, root: info.root, pathPrefix };
  } catch (error) {
    try { db.exec("rollback"); } catch { /* already closed or not in transaction */ }
    throw error;
  } finally {
    db.close();
  }
}

export function status(cwd = process.cwd(), options: { health?: "cheap" | "full"; pathPrefix?: string } = {}) {
  const healthMode = options.health ?? "cheap";
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const info = getRepoInfo(cwd);
  if (!info.approved) {
    return { ...info, indexed: false, files: 0, chunks: 0, symbols: 0, lastIndexedAt: null, health: healthMode, stale: false, changed: 0, missing: 0, deleted: 0, warnings: [] };
  }
  const db = openRepoDb(info.dbPath);
  try {
    const files = pathPrefix
      ? (db.prepare("select count(*) as n from files where path like ?").get(`${pathPrefix}%`) as { n: number }).n
      : (db.prepare("select count(*) as n from files").get() as { n: number }).n;
    const chunks = pathPrefix
      ? (db.prepare("select count(*) as n from chunks join files f on f.id = chunks.file_id where f.path like ?").get(`${pathPrefix}%`) as { n: number }).n
      : (db.prepare("select count(*) as n from chunks").get() as { n: number }).n;
    const symbols = pathPrefix
      ? (db.prepare("select count(*) as n from symbols join files f on f.id = symbols.file_id where f.path like ?").get(`${pathPrefix}%`) as { n: number }).n
      : (db.prepare("select count(*) as n from symbols").get() as { n: number }).n;
    const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;
    const base = { ...info, indexed: files > 0, files, chunks, symbols, lastIndexedAt, health: healthMode, pathPrefix };
    if (healthMode === "cheap") return { ...base, stale: false, changed: 0, missing: 0, deleted: 0, warnings: [] };
    return { ...base, ...indexHealth(db, info.root, pathPrefix) };
  } finally {
    db.close();
  }
}

function indexHealth(db: ReturnType<typeof openRepoDb>, root: string, pathPrefix = "") {
  const scan = scanRepo(root, { pathPrefix });
  const rows = (pathPrefix
    ? db.prepare("select path, hash from files where path like ?").all(`${pathPrefix}%`)
    : db.prepare("select path, hash from files").all()) as Array<{ path: string; hash: string }>;
  const indexed = new Map(rows.map((row) => [row.path, row.hash]));
  const current = new Map(scan.files.map((file) => [file.relPath, file.hash]));
  let changed = 0;
  let missing = 0;
  let deleted = 0;
  for (const [path, hash] of current) {
    if (!indexed.has(path)) missing++;
    else if (indexed.get(path) !== hash) changed++;
  }
  for (const path of indexed.keys()) if (!current.has(path)) deleted++;
  const stale = changed > 0 || missing > 0 || deleted > 0;
  const warnings = [...scan.warnings];
  if (stale) warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
  return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, warnings };
}
