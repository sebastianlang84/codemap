import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getReposDir, listRegistryRepos, removeRegistryRepos, resolveStateDir, type StateOptions } from "./repo.ts";

const DB_EXTENSION = ".sqlite";
// SQLite may leave sidecar files (WAL journal, shared-memory) next to a repo DB.
const DB_SIDECAR_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;

export type StateGcReason = "orphan_db" | "missing_root";

export interface StateGcCandidate {
  /** Repo DB key (the `<key>.sqlite` basename). */
  key: string;
  dbPath: string;
  /** On-disk bytes of the DB plus any SQLite sidecar files. */
  bytes: number;
  reason: StateGcReason;
  /** Registry root for `missing_root` candidates; absent for orphan DBs with no registry row. */
  rootPath?: string;
}

export interface StateGcResult {
  stateDir: string;
  /** Number of `<key>.sqlite` files found under the repos directory. */
  repoDbCount: number;
  /** Number of approved repos in the registry. */
  registryRepoCount: number;
  candidates: StateGcCandidate[];
  /** Total bytes the candidates would free. */
  reclaimableBytes: number;
  /** True when files/registry rows were actually deleted (apply), false for a dry-run plan. */
  applied: boolean;
  /** Registry rows removed on apply. */
  removedRegistryRows: number;
}

function dbGroupBytes(dbPath: string): number {
  let total = 0;
  for (const suffix of DB_SIDECAR_SUFFIXES) {
    const sidecar = `${dbPath}${suffix}`;
    if (!existsSync(sidecar)) continue;
    try {
      total += statSync(sidecar).size;
    } catch {
      /* raced deletion or unreadable sidecar: ignore */
    }
  }
  return total;
}

function removeDbGroup(dbPath: string): void {
  for (const suffix of DB_SIDECAR_SUFFIXES) rmSync(`${dbPath}${suffix}`, { force: true });
}

/**
 * Read-only scan for reclaimable per-repo index DBs:
 * - `orphan_db`: a `<key>.sqlite` with no registry row (approval was removed but the index lingered).
 * - `missing_root`: an approved repo whose root path no longer exists on disk (repo was deleted/moved).
 */
export function collectStateGcCandidates(options: StateOptions = {}): StateGcResult {
  const stateDir = resolveStateDir(options.stateDir);
  const reposDir = getReposDir(options);
  const registry = listRegistryRepos(options);
  const rootByKey = new Map(registry.map((repo) => [repo.key, repo.rootPath]));

  const dbNameByKey = new Map<string, string>();
  if (existsSync(reposDir)) {
    for (const name of readdirSync(reposDir)) {
      if (name.endsWith(DB_EXTENSION)) dbNameByKey.set(name.slice(0, -DB_EXTENSION.length), name);
    }
  }

  const candidates: StateGcCandidate[] = [];
  for (const [key, name] of dbNameByKey) {
    const dbPath = join(reposDir, name);
    const rootPath = rootByKey.get(key);
    if (rootPath === undefined) {
      candidates.push({ key, dbPath, bytes: dbGroupBytes(dbPath), reason: "orphan_db" });
    } else if (!existsSync(rootPath)) {
      candidates.push({ key, dbPath, bytes: dbGroupBytes(dbPath), reason: "missing_root", rootPath });
    }
  }

  // Registry rows whose root is gone but whose DB was already deleted still leak an approval row.
  for (const repo of registry) {
    if (dbNameByKey.has(repo.key) || existsSync(repo.rootPath)) continue;
    candidates.push({ key: repo.key, dbPath: join(reposDir, `${repo.key}${DB_EXTENSION}`), bytes: 0, reason: "missing_root", rootPath: repo.rootPath });
  }

  const reclaimableBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  return {
    stateDir,
    repoDbCount: dbNameByKey.size,
    registryRepoCount: registry.length,
    candidates,
    reclaimableBytes,
    applied: false,
    removedRegistryRows: 0,
  };
}

/**
 * Plan reclaimable repo DBs and, when `apply` is set, delete them plus their registry rows.
 * Index DBs are rebuildable, so pruning only affects cached data and stale approvals.
 */
export function pruneState(options: StateOptions & { apply?: boolean } = {}): StateGcResult {
  const plan = collectStateGcCandidates(options);
  if (!options.apply) return plan;
  for (const candidate of plan.candidates) removeDbGroup(candidate.dbPath);
  const missingRootKeys = plan.candidates.filter((candidate) => candidate.reason === "missing_root").map((candidate) => candidate.key);
  const removedRegistryRows = removeRegistryRepos(missingRootKeys, options);
  return { ...plan, applied: true, removedRegistryRows };
}
