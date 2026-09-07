import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runtimePaths = ["dist", "migrations", "package.json", "package-lock.json"];
const excludedNames = /^(?:scripts?|tests?|__tests__|docs?|fixtures?|manifests?|references?|\.git|\.bin)$/i;

/** Reject links before walking: dependency links must never expose evaluation sources. */
export function validateRuntimeProfile(root: string): void {
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("Unsafe runtime profile root");
  const allowed = new Set([...runtimePaths, "node_modules", ".runtime-profile.json"]);
  for (const name of readdirSync(root)) {
    if (!allowed.has(name)) throw new Error(`Unexpected runtime profile entry: ${name}`);
  }
  function walk(directory: string): void {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsafe runtime profile entry: ${path}`);
      if (excludedNames.test(name)) throw new Error(`Evaluation-only runtime profile entry: ${path}`);
      if (stat.isDirectory()) walk(path);
    }
  }
  walk(root);
}

/** Unique per invocation: old full-repository profiles and parallel caches are never reused. */
export function createRuntimeProfile(options: {
  repository: string;
  commit: string;
  expectedVersion: string;
  cacheDir: string;
  env: NodeJS.ProcessEnv;
  offline?: boolean;
}): string {
  const { repository, commit, expectedVersion, cacheDir, env } = options;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Runtime profile requires a full source commit");
  const git = (args: string[]) => execFileSync("git", args, { cwd: repository, env, maxBuffer: 128 * 1024 * 1024 });
  const resolved = git(["rev-parse", `${commit}^{commit}`]).toString().trim();
  if (resolved !== commit) throw new Error("Runtime profile source commit mismatch");
  const entries = git(["ls-tree", "-r", "-z", commit, "--", ...runtimePaths]).toString().split("\0").filter(Boolean);
  if (entries.some(entry => !/^100(?:644|755) blob /.test(entry))) throw new Error("Runtime profile source contains links or non-files");
  mkdirSync(join(cacheDir, "profiles"), { recursive: true });
  const target = mkdtempSync(join(cacheDir, "profiles", `runtime-v1-${commit}-`));
  try {
    const archive = git(["archive", "--format=tar", commit, "--", ...runtimePaths]);
    const unpack = spawnSync("tar", ["-x", "-C", target], { input: archive, env });
    if (unpack.status !== 0) throw new Error("Runtime profile extraction failed");
    validateRuntimeProfile(target);
    const metadata = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    if (metadata.version !== expectedVersion) throw new Error("Runtime profile package version mismatch");
    const install = spawnSync("npm", ["ci", "--omit=dev", "--omit=peer", "--ignore-scripts", "--no-audit", "--no-fund", ...(options.offline ? ["--offline"] : [])], {
      cwd: target, env, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (install.status !== 0) throw new Error(`CodeMap runtime install failed: ${install.stderr.slice(-2000)}`);
    // Installed package documentation and build/test helpers are not agent inputs.
    function prune(directory: string): void {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (excludedNames.test(name)) rmSync(path, { recursive: true, force: true });
        else if (lstatSync(path).isDirectory()) prune(path);
      }
    }
    if (existsSync(join(target, "node_modules"))) prune(join(target, "node_modules"));
    const { name, version, type, bin, engines, dependencies } = metadata;
    writeFileSync(join(target, "package.json"), JSON.stringify({ name, version, type, bin, engines, dependencies }) + "\n");
    writeFileSync(join(target, ".runtime-profile.json"), JSON.stringify({ schemaVersion: 1, sourceCommit: commit, expectedVersion }) + "\n");
    validateRuntimeProfile(target);
    const actualVersion = execFileSync(process.execPath, [join(target, "dist", "cli", "bin.js"), "--version"], { env, encoding: "utf8" }).trim();
    if (actualVersion !== expectedVersion) throw new Error(`CodeMap profile version ${actualVersion} != ${expectedVersion}`);
    return target;
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}
