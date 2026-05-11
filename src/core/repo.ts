import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { RepoInfo } from "./types.ts";

const baseDir = join(homedir(), ".pi", "agent", "codemap");
const legacyBaseDir = join(homedir(), ".pi", "agent", "code-search");
const registryPath = join(baseDir, "registry.sqlite");
const legacyRegistryPath = join(legacyBaseDir, "registry.sqlite");

function copyLegacyFileIfNeeded(source: string, target: string): void {
  if (existsSync(target) || !existsSync(source)) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

export function getRegistryPath(): string {
  mkdirSync(baseDir, { recursive: true });
  copyLegacyFileIfNeeded(legacyRegistryPath, registryPath);
  return registryPath;
}

export function findRepoRoot(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`Not inside a Git repository: ${cwd}`);
  }
}

export function getRemote(root: string): string | undefined {
  try {
    return execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function repoKey(root: string): string {
  return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
}

function registryDb(): DatabaseSync {
  const activeRegistryPath = getRegistryPath();
  mkdirSync(dirname(activeRegistryPath), { recursive: true });
  const db = new DatabaseSync(activeRegistryPath);
  db.exec(`
    create table if not exists repos (
      key text primary key,
      root_path text not null unique,
      git_remote text,
      enabled integer not null default 1,
      approved_at text not null,
      approval_source text not null,
      updated_at text not null
    );
  `);
  return db;
}

export function getRepoInfo(cwd = process.cwd()): RepoInfo {
  const root = findRepoRoot(cwd);
  const key = repoKey(root);
  const dbPath = join(baseDir, "repos", `${key}.sqlite`);
  copyLegacyFileIfNeeded(join(legacyBaseDir, "repos", `${key}.sqlite`), dbPath);
  const db = registryDb();
  const row = db.prepare("select enabled from repos where key = ?").get(key) as { enabled: number } | undefined;
  db.close();
  return { root, key, remote: getRemote(root), approved: row?.enabled === 1, dbPath };
}

export function approveRepo(cwd = process.cwd(), source = "tool"): RepoInfo {
  const info = getRepoInfo(cwd);
  mkdirSync(dirname(info.dbPath), { recursive: true });
  const db = registryDb();
  const now = new Date().toISOString();
  db.prepare(`
    insert into repos(key, root_path, git_remote, enabled, approved_at, approval_source, updated_at)
    values (?, ?, ?, 1, ?, ?, ?)
    on conflict(key) do update set
      root_path = excluded.root_path,
      git_remote = excluded.git_remote,
      enabled = 1,
      approval_source = excluded.approval_source,
      updated_at = excluded.updated_at
  `).run(info.key, info.root, info.remote ?? null, now, source, now);
  db.close();
  return { ...info, approved: true };
}
