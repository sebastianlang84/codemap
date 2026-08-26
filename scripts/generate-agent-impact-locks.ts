#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = process.argv.slice(2);
if (!rawArgs.includes("--approve-refresh")) {
  throw new Error("Refusing to regenerate frozen locks; pass --approve-refresh [cache directory]");
}
const cacheArg = rawArgs.find((arg) => arg !== "--approve-refresh");
const cacheRoot = resolve(cacheArg ?? join(homedir(), ".cache", "codemap", "external-holdout-v1", "repositories"));
const outputRoot = join(repoRoot, "scripts", "fixtures", "agent-impact-locks");

const profiles = [
  ["fastify", "83e69762aff047940b376fc2a266d143499ef727", "fastify-6965.package-lock.json"],
  ["fastify", "eaff726a68c629c1aedc99f96b3c4b95dfdb38d1", "fastify-6942.package-lock.json"],
  ["fastify", "a2f590563f111ebc8e92b8f17701909e9b19d4b7", "fastify-6892-6846.package-lock.json"],
  ["fastify", "74c44c94afea276256721316d25218d1cdd1aae4", "fastify-6889.package-lock.json"],
  ["fastify", "b6cdc6a40598d15f38fe7d399eb17f4b84b7bf06", "fastify-6881-6865.package-lock.json"],
  ["fastify", "8b9c07b645a8156c23a1d2619267fc84ea879250", "fastify-6803.package-lock.json"],
  ["express", "715101bd27ec9c14a7ccc8a37c476f330d98ad53", "express-7377.package-lock.json"],
  ["express", "d39e8ad1778a0b8a606a5a7b17096d0cc5ec722d", "express-7181.package-lock.json"],
] as const;

mkdirSync(outputRoot, { recursive: true });
for (const [repo, commit, filename] of profiles) {
  const work = mkdtempSync(join(tmpdir(), `codemap-agent-impact-lock-${repo}-`));
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", commit], {
      cwd: join(cacheRoot, repo),
      maxBuffer: 128 * 1024 * 1024,
    });
    const extract = spawnSync("tar", ["-x", "-C", work], { input: archive, maxBuffer: 4 * 1024 * 1024 });
    if (extract.status !== 0) throw new Error(`tar failed for ${repo}@${commit}`);
    const npm = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: work,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 300_000,
    });
    if (npm.status !== 0) throw new Error(`npm lock failed for ${repo}@${commit}: ${npm.stderr.slice(-1200)}`);
    const lock = readFileSync(join(work, "package-lock.json"));
    writeFileSync(join(outputRoot, filename), lock);
    console.log(`${filename}\t${lock.length}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
