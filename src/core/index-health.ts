import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { openRepoDb } from "./db.ts";
import { readGitWorkingTreeStatus, type GitDirtyFile } from "./git-status.ts";
import { readIndexedFileStats } from "./index-store.ts";
import { createScanPolicy } from "./scan-policy.ts";
import { scanRepo } from "./scanner.ts";
import { escapeLike } from "./text-util.ts";

export interface IndexStatusCounts {
  indexed: boolean;
  files: number;
  chunks: number;
  symbols: number;
  lastIndexedAt: string | null;
  indexedHead: string | null;
}

export interface IndexHealth {
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  skipped?: number;
  skippedReasons?: Record<string, number>;
  warnings: string[];
  currentHead: string | null;
  headChanged: boolean;
  dirty: boolean;
  dirtyFiles: GitDirtyFile[];
}

export function readIndexStatusCounts(db: ReturnType<typeof openRepoDb>, pathPrefix = ""): IndexStatusCounts {
  const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "";
  const files = pathPrefix
    ? (db.prepare("select count(*) as n from files where path like ? escape '\\'").get(pathFilter) as { n: number }).n
    : (db.prepare("select count(*) as n from files").get() as { n: number }).n;
  const chunks = pathPrefix
    ? (db.prepare("select count(*) as n from chunks join files f on f.id = chunks.file_id where f.path like ? escape '\\'").get(pathFilter) as { n: number }).n
    : (db.prepare("select count(*) as n from chunks").get() as { n: number }).n;
  const symbols = pathPrefix
    ? (db.prepare("select count(*) as n from symbols join files f on f.id = symbols.file_id where f.path like ? escape '\\'").get(pathFilter) as { n: number }).n
    : (db.prepare("select count(*) as n from symbols").get() as { n: number }).n;
  const lastIndexedAt = readPathAwareMeta(db, "last_indexed_at", pathPrefix);
  const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
  return { indexed: files > 0, files, chunks, symbols, lastIndexedAt, indexedHead };
}

export function cheapIndexHealth(db: ReturnType<typeof openRepoDb>, root: string, pathPrefix = ""): IndexHealth {
  const git = readGitWorkingTreeStatus(root, pathPrefix, "auto");
  const currentHead = git.currentHead;
  const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
  const headChanged = Boolean(indexedHead && currentHead && indexedHead !== currentHead);
  const warnings: string[] = [];
  let stale: boolean;
  if (currentHead === null && indexedHead !== null) {
    // HEAD became unreadable after the index was built against a real commit
    stale = true;
    warnings.push("Git HEAD unreadable — index may be stale.");
  } else if (headChanged) {
    stale = true;
    warnings.push("Git HEAD changed since last index.");
  } else if (currentHead !== null && indexedHead === null) {
    // Repo has commits but was never indexed with a HEAD baseline
    stale = true;
    warnings.push("No indexed HEAD baseline — index may be stale.");
  } else {
    stale = false;
  }
  const indexedFile = db.prepare("select mtime_ms as mtimeMs, size from files where path=?");
  const filePolicy = createScanPolicy(root, { discoverNestedWorktrees: false });
  let directoryPolicy: ReturnType<typeof createScanPolicy> | undefined;
  const relevantDirty = git.dirtyFiles.filter((file) => {
    const path = file.path.replace(/\/$/, "");
    const basename = path.slice(path.lastIndexOf("/") + 1);
    const ignoreRuleFile = basename === ".gitignore" || path === ".codemapignore";
    if (ignoreRuleFile && file.status === "deleted") return true;
    const indexed = indexedFile.get(path) as { mtimeMs: number; size: number } | undefined;
    if (file.status === "deleted") return indexed !== undefined;
    try {
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) return false;
      if (indexed && indexed.size === stat.size && Math.round(indexed.mtimeMs) === Math.round(stat.mtimeMs)) return false;
      if (filePolicy.entrySkipReason(path, stat.isDirectory())) return false;
      if (ignoreRuleFile) return true;
      if (stat.isDirectory()) {
        directoryPolicy ??= createScanPolicy(root);
        if (directoryPolicy.entrySkipReason(path, true)) return false;
        return directoryContainsIndexableFile(root, path, directoryPolicy);
      }
      const language = filePolicy.fileLanguageOrSkipReason(path, stat.size);
      if (!language.language) return false;
      return filePolicy.contentSkipReason(readFileSync(join(root, path))) === undefined;
    } catch {
      return indexed !== undefined;
    }
  });
  if (relevantDirty.length > 0) {
    stale = true;
    warnings.push(`Working tree changed in ${relevantDirty.length} indexable path${relevantDirty.length === 1 ? "" : "s"}; run full status for file-level counts.`);
  }
  return { stale, changed: 0, missing: 0, deleted: 0, currentHead, headChanged, dirty: git.dirty, dirtyFiles: git.dirtyFiles, warnings };
}

function directoryContainsIndexableFile(root: string, relDir: string, policy: ReturnType<typeof createScanPolicy>): boolean {
  // Git's normal untracked mode collapses a whole tree to `dir/`. Inspect only that tree and stop at
  // the first indexable file. The bound keeps cheap health cheap on generated/untracked forests; if
  // it is reached (or the tree races us), report stale conservatively instead of hiding real drift.
  let remainingEntries = 2_048;

  const visit = (directory: string): boolean => {
    let entries;
    try {
      entries = readdirSync(join(root, directory), { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      remainingEntries--;
      if (remainingEntries < 0) return true;
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (policy.entrySkipReason(path, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        if (visit(path)) return true;
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === ".gitignore") return true;
      try {
        const stat = statSync(join(root, path));
        if (!policy.fileLanguageOrSkipReason(path, stat.size).language) continue;
        if (policy.contentSkipReason(readFileSync(join(root, path))) === undefined) return true;
      } catch {
        return true;
      }
    }
    return false;
  };

  return visit(relDir);
}

export function fullIndexHealth(db: ReturnType<typeof openRepoDb>, root: string, pathPrefix = ""): IndexHealth {
  // Reuse the indexer's mtime+size fastpath so unchanged files are not re-read and re-hashed on every
  // `context` / `status --health full` call: a single files read serves both the scanner fastpath and
  // the comparison map. `text` is never consumed here (only `hash`), so — unlike the incremental
  // indexer (indexer.ts) — no forced-reindex guard is needed. The `path = ?`/LIKE-prefix filter the
  // old query used is equivalent to `startsWith(pathPrefix)` (pathPrefix is a normalized dir prefix).
  const knownFiles = readIndexedFileStats(db);
  const scan = scanRepo(root, { pathPrefix, knownFiles });
  const indexed = new Map<string, string>();
  for (const [path, stat] of knownFiles) {
    if (!pathPrefix || path.startsWith(pathPrefix)) indexed.set(path, stat.hash);
  }
  const current = new Map(scan.files.map((file) => [file.relPath, file.hash]));
  let changed = 0;
  let missing = 0;
  let deleted = 0;
  for (const [path, hash] of current) {
    if (!indexed.has(path)) missing++;
    else if (indexed.get(path) !== hash) changed++;
  }
  for (const path of indexed.keys()) if (!current.has(path)) deleted++;
  const fileDrift = changed > 0 || missing > 0 || deleted > 0;
  const warnings = [...scan.warnings];
  if (fileDrift) warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
  const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
  const git = readGitWorkingTreeStatus(root, pathPrefix);
  const headChanged = Boolean(indexedHead && git.currentHead && indexedHead !== git.currentHead);
  const dirtyFiles = git.dirtyFiles;
  const dirty = dirtyFiles.length > 0;
  // Only dirty paths the index actually covers can make it stale. Untracked content codemap never
  // indexes — a nested worktree, editor state, logs, all folded by git into a single `?? .claude/`
  // entry — otherwise marked every `context` call stale forever, since no `codemap index` run could
  // clear it. Files added or removed under such a directory still surface as changed/missing/deleted
  // through the hash comparison above, so no real drift is lost. `dirty`/`dirtyFiles` stay the raw
  // git view.
  const indexRelevantDirtyFiles = dirtyFiles.filter((file) => indexed.has(file.path) || current.has(file.path));
  const hasIndexedGitBaseline = Boolean(indexedHead && git.currentHead);
  const dirtyIndexedFiles = hasIndexedGitBaseline ? indexRelevantDirtyFiles.length : 0;
  if (headChanged) warnings.push("Git HEAD changed since last index.");
  if (dirtyIndexedFiles > 0) warnings.push(`Working tree dirty: ${dirtyIndexedFiles} indexed file${dirtyIndexedFiles === 1 ? "" : "s"}.`);
  const stale = fileDrift || headChanged || dirtyIndexedFiles > 0;
  return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, currentHead: git.currentHead, headChanged, dirty, dirtyFiles, warnings };
}

function readPathAwareMeta(db: ReturnType<typeof openRepoDb>, baseKey: string, pathPrefix: string): string | null {
  const scoped = pathPrefix ? readMeta(db, `${baseKey}:${pathPrefix}`) : null;
  return scoped ?? readMeta(db, baseKey);
}

function readMeta(db: ReturnType<typeof openRepoDb>, key: string): string | null {
  const value = (db.prepare("select value from meta where key=?").get(key) as { value: string } | undefined)?.value ?? null;
  return value || null;
}
