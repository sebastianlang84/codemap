import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, type TestContext } from "node:test";

const storageHome = mkdtempSync(join(tmpdir(), "pi-code-search-home-"));
process.env.HOME = storageHome;
process.env.USERPROFILE = storageHome;
after(() => rmSync(storageHome, { recursive: true, force: true }));

const { indexRepo, status } = await import("../src/core/indexer.ts");
const { searchCodebase, searchCodebaseWithDiagnostics } = await import("../src/core/search.ts");
const { codebaseContext } = await import("../src/core/context.ts");

function fixtureRepo(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pi-code-search-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "core"), { recursive: true });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "src", "core", "user-service.ts"), `
export function approveUser(id: string) {
  return { id, status: "approved" };
}

export function archiveUser(id: string) {
  return { id, status: "archived" };
}
`);
  writeFileSync(join(root, "src", "core", "numeric.ts"), `
export const NOT_FOUND_STATUS = 404;
export const LOCAL_PORT = 3000;
`);
  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), `
export function registerTool(name: string) {
  return name;
}
`);
  writeFileSync(join(root, "docs", "ops.md"), `
# Operations

The scanner reports an ignored directory when dependency folders are skipped.
`);
  writeFileSync(join(root, "docs", "alpha-beta.md"), `
# Alpha Beta

The alpha beta workflow covers complete matches.
`);
  writeFileSync(join(root, "docs", "alpha-spam.md"), `
# Alpha

alpha alpha alpha alpha alpha alpha alpha alpha
`);
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "ignored directory approveUser left-pad" }, null, 2));

  indexRepo({ cwd: root, approve: true });
  return root;
}

test("exact symbol matches rank above chunk matches", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodebase({ cwd: root, query: "approveUser", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
  assert.match(results[0]?.snippet ?? "", /approveUser/);
});

test("prefix symbol queries prefer matching symbols", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodebase({ cwd: root, query: "approve", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
});

test("path-like queries return file matches first", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodebase({ cwd: root, query: "tools.ts", limit: 5 });
  assert.equal(results[0]?.path, "src/pi-extension/tools.ts");
  assert.equal(results[0]?.kind, "file");
});

test("phrase queries find phrase-bearing docs without lockfile noise", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodebase({ cwd: root, query: "\"ignored directory\"", limit: 5 });
  assert.equal(results[0]?.path, "docs/ops.md");
  assert.ok(results.every((result) => result.path !== "package-lock.json"));
});

test("multi-term queries prefer all-term matches over OR fallback", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodebase({ cwd: root, query: "alpha beta", limit: 5 });
  assert.equal(results[0]?.path, "docs/alpha-beta.md");
  assert.match(results[0]?.snippet ?? "", /alpha beta/i);
});

test("numeric queries remain searchable", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodebase({ cwd: root, query: "404", limit: 5 });
  assert.equal(results[0]?.path, "src/core/numeric.ts");
  assert.match(results[0]?.snippet ?? "", /404/);
});

test("search diagnostics warn without auto-refreshing stale indexes", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "new-feature.ts"), `
export function newFeatureFlag() {
  return true;
}
`);

  const result = searchCodebaseWithDiagnostics({ cwd: root, query: "newFeatureFlag", limit: 5 });
  assert.equal(result.stale, true);
  assert.equal(result.missing, 1);
  assert.match(result.warnings.join("\n"), /Index stale/);
  assert.equal(result.results.length, 0);

  indexRepo({ cwd: root });
  const refreshed = searchCodebaseWithDiagnostics({ cwd: root, query: "newFeatureFlag", limit: 5 });
  assert.equal(refreshed.stale, false);
  assert.equal(refreshed.results[0]?.path, "src/core/new-feature.ts");
});

test("context diagnostics warn without auto-refreshing stale indexes", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "context-added.ts"), `
export function contextAdded() {
  return true;
}
`);

  const result = codebaseContext({ cwd: root, target: "contextAdded", limit: 5 });
  assert.equal(result.stale, true);
  assert.equal(result.missing, 1);
  assert.match(result.warnings.join("\n"), /Index stale/);
  assert.deepEqual(result.readFirst, []);
});

test("safety skips secrets, generated files, heavy directories, binary files, large files, and symlinks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-code-search-safety-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "src", "allowed.ts"), "export const allowedNeedle = true;\n");
  writeFileSync(join(root, ".env"), "SUPER_SKIPPED_NEEDLE=1\n");
  writeFileSync(join(root, "private-key.ts"), "export const superSkippedNeedle = true;\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ superSkippedNeedle: true }));
  writeFileSync(join(root, "binary.txt"), Buffer.from("superSkippedNeedle\0"));
  writeFileSync(join(root, "huge.txt"), `${"x".repeat(1_000_001)}superSkippedNeedle`);
  writeFileSync(join(root, "ignored.txt"), "superSkippedNeedle\n");
  writeFileSync(join(root, "node_modules", "dep", "index.ts"), "export const superSkippedNeedle = true;\n");
  writeFileSync(join(root, "dist", "bundle.ts"), "export const superSkippedNeedle = true;\n");
  try {
    symlinkSync(join(root, "src", "allowed.ts"), join(root, "linked.ts"));
  } catch {
    // Some platforms disallow symlink creation; the rest of the safety policy is still testable.
  }

  const result = indexRepo({ cwd: root, approve: true });
  assert.equal(searchCodebase({ cwd: root, query: "allowedNeedle", limit: 5 })[0]?.path, "src/allowed.ts");
  assert.deepEqual(searchCodebase({ cwd: root, query: "superSkippedNeedle", limit: 5 }), []);
  assert.ok((result.skippedReasons["secret-like file"] ?? 0) >= 2);
  assert.ok((result.skippedReasons["binary/generated extension"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["ignored directory"] ?? 0) >= 2);
  assert.ok((result.skippedReasons[".gitignore"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["binary content"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["too large"] ?? 0) >= 1);
  if (existsSync(join(root, "linked.ts"))) assert.ok((result.skippedReasons.symlink ?? 0) >= 1);
});

test("index refreshes only changed files and removes deleted files", (t) => {
  const root = fixtureRepo(t);
  assert.equal(indexRepo({ cwd: root }).indexed, 0);

  writeFileSync(join(root, "src", "core", "user-service.ts"), `
export function changedUserFlow(id: string) {
  return { id, status: "changed" };
}
`);
  const changed = indexRepo({ cwd: root });
  assert.equal(changed.indexed, 1);
  assert.equal(searchCodebase({ cwd: root, query: "changedUserFlow", limit: 5 })[0]?.path, "src/core/user-service.ts");
  assert.deepEqual(searchCodebase({ cwd: root, query: "approveUser", limit: 5 }), []);

  unlinkSync(join(root, "src", "core", "numeric.ts"));
  const removed = indexRepo({ cwd: root });
  assert.equal(removed.removed, 1);
  assert.deepEqual(searchCodebase({ cwd: root, query: "404", limit: 5 }), []);
});

test("cheap status avoids stale scan while full status reports drift", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "cheap-status-added.ts"), `
export function cheapStatusAdded() {
  return true;
}
`);

  const cheap = status(root, { health: "cheap" });
  assert.equal(cheap.health, "cheap");
  assert.equal(cheap.stale, false);
  assert.equal(cheap.missing, 0);
  assert.deepEqual(cheap.warnings, []);

  const full = status(root, { health: "full" });
  assert.equal(full.health, "full");
  assert.equal(full.stale, true);
  assert.equal(full.missing, 1);
  assert.match(full.warnings.join("\n"), /Index stale/);
});
