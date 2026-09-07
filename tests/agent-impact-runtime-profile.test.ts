import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexContainerArgs } from "../scripts/eval-agent-impact-codex.ts";
import { createRuntimeProfile, validateRuntimeProfile } from "../scripts/eval-agent-impact-runtime-profile.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "codemap-runtime-profile-test-"));
  const repository = join(root, "source");
  mkdirSync(join(repository, "dist", "cli"), { recursive: true });
  mkdirSync(join(repository, "migrations"));
  writeFileSync(join(repository, "dist", "cli", "bin.js"), "console.log('1.0.0');\n");
  writeFileSync(join(repository, "migrations", "001.sql"), "select 1;\n");
  const metadata = { name: "runtime-fixture", version: "1.0.0", type: "module", scripts: { test: "secret-evaluation-script" } };
  writeFileSync(join(repository, "package.json"), JSON.stringify(metadata));
  writeFileSync(join(repository, "package-lock.json"), JSON.stringify({ name: metadata.name, version: metadata.version, lockfileVersion: 3, packages: { "": { name: metadata.name, version: metadata.version } } }));
  for (const directory of ["scripts", "tests", "docs", "fixtures", "manifests", "references", "src"]) {
    mkdirSync(join(repository, directory));
    writeFileSync(join(repository, directory, "denied-marker"), "EVALUATION_SOURCE_MUST_NOT_BE_VISIBLE");
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const options = { repository, commit: git("rev-parse", "HEAD"), expectedVersion: "1.0.0", cacheDir: join(root, "cache"), env: process.env, offline: true };
  return { root, repository, options, git };
}

test("runtime profiles bind a source commit and never reuse old or shared cache contents", () => {
  const { root, options } = fixture();
  try {
    const stale = join(options.cacheDir, "profiles", `codemap-1.0.0-${options.commit.slice(0, 12)}`);
    mkdirSync(join(stale, "dist", "cli"), { recursive: true });
    writeFileSync(join(stale, "dist", "cli", "bin.js"), "console.log('1.0.0')");
    writeFileSync(join(stale, "denied-marker"), "unsafe cached source");
    const first = createRuntimeProfile(options);
    const second = createRuntimeProfile(options);
    assert.notEqual(first, second);
    assert.notEqual(first, stale);
    assert.equal(readFileSync(join(stale, "denied-marker"), "utf8"), "unsafe cached source");
    assert.deepEqual(JSON.parse(readFileSync(join(first, ".runtime-profile.json"), "utf8")), { schemaVersion: 1, sourceCommit: options.commit, expectedVersion: "1.0.0" });
    assert.equal(JSON.parse(readFileSync(join(first, "package.json"), "utf8")).scripts, undefined);
    for (const path of ["scripts", "tests", "docs", "fixtures", "manifests", "references", "src", ".git"]) assert.equal(existsSync(join(first, path)), false);
    validateRuntimeProfile(first);
    assert.throws(() => createRuntimeProfile({ ...options, commit: "HEAD" }), /full source commit/);
    assert.throws(() => createRuntimeProfile({ ...options, expectedVersion: "9.0.0" }), /package version mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runtime profile rejects source and dependency symlink escapes", () => {
  const { root, repository, options, git } = fixture();
  try {
    const target = createRuntimeProfile(options);
    mkdirSync(join(target, "node_modules", "leak"), { recursive: true });
    symlinkSync(join(repository, "scripts"), join(target, "node_modules", "leak", "entry"));
    assert.throws(() => validateRuntimeProfile(target), /Unsafe runtime profile/);
    symlinkSync(join(repository, "scripts", "denied-marker"), join(repository, "dist", "leak.js"));
    git("add", "dist/leak.js");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "link");
    assert.throws(() => createRuntimeProfile({ ...options, commit: git("rev-parse", "HEAD") }), /contains links/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("both agent arms can execute the runtime but cannot read evaluation sources through bwrap", () => {
  const { root, repository, options } = fixture();
  const attempt = mkdtempSync(join(tmpdir(), "codemap-runtime-attempt-"));
  try {
    const profile = createRuntimeProfile(options);
    const unsafeCache = join(options.cacheDir, "profiles", "old-profile");
    mkdirSync(unsafeCache);
    writeFileSync(join(unsafeCache, "denied-marker"), "EVALUATION_SOURCE_MUST_NOT_BE_VISIBLE");
    for (const arm of ["baseline", "codemap"]) {
      const probe = `const fs=require('node:fs'),cp=require('node:child_process');
        for(const p of ${JSON.stringify([repository, unsafeCache, ...["scripts", "tests", "docs", "fixtures", "manifests", "references", "src"].map(path => join(profile, path))])}) {
          if(fs.existsSync(p))throw Error('Evaluation source visible: '+p);
        }
        if(cp.execFileSync(process.execPath,[${JSON.stringify(join(profile, "dist", "cli", "bin.js"))},'--version'],{encoding:'utf8'}).trim()!=='1.0.0')throw Error('Runtime unavailable');`;
      const result = spawnSync("bwrap", [...codexContainerArgs("/usr/bin/node", attempt, profile), "-e", probe], { encoding: "utf8", timeout: 20_000 });
      assert.equal(result.status, 0, `${arm}: ${result.stderr}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(attempt, { recursive: true, force: true }); }
});
