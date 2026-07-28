import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

const { parseNestedWorktrees } = await import("../src/core/scan-policy.ts");
const { scanRepo } = await import("../src/core/scanner.ts");
const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");

useIsolatedHome("pi-codemap-worktree-home-");

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

/** A repository holding one symbol, plus a worktree of itself at `.claude/worktrees/x`. */
function repoWithNestedWorktree(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-worktree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "auth.ts"), "export function registerCurated(name: string) {\n  return name;\n}\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "init");
  git(root, "worktree", "add", join(root, ".claude", "worktrees", "x"));
  return root;
}

test("parseNestedWorktrees keeps only worktrees nested inside the scanned root", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/x",
    "HEAD abc",
    "branch refs/heads/x",
    "",
    "worktree /elsewhere/sibling-tree",
    "HEAD abc",
    "detached",
    "",
  ].join("\n");

  assert.deepEqual(parseNestedWorktrees("/repo", porcelain), [".claude/worktrees/x"]);
});

test("parseNestedWorktrees never skips the root itself, so indexing from inside a worktree works", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD abc",
    "",
    "worktree /repo/.claude/worktrees/x",
    "HEAD abc",
    "",
  ].join("\n");

  // Scanning the worktree: the main repository lies outside it and the worktree is the target.
  assert.deepEqual(parseNestedWorktrees("/repo/.claude/worktrees/x", porcelain), []);
});

test("parseNestedWorktrees tolerates output without any worktree lines", () => {
  assert.deepEqual(parseNestedWorktrees("/repo", ""), []);
});

test("the scanner skips a nested worktree instead of indexing a second copy of the tree", (t) => {
  const root = repoWithNestedWorktree(t);

  const result = scanRepo(root);
  const paths = result.files.map((file) => file.relPath).sort();

  assert.deepEqual(paths, ["src/auth.ts"], "only the main checkout is scanned");
  assert.equal(result.skippedReasons["nested git worktree"], 1);
  assert.equal(result.incomplete, false, "skipping a worktree must not suppress the deletion pass");
});

test("a worktree is skipped as a worktree, not because .claude is ignored", (t) => {
  const root = repoWithNestedWorktree(t);
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), '{ "note": "regular file inside .claude" }\n');

  const paths = scanRepo(root).files.map((file) => file.relPath).sort();

  assert.deepEqual(paths, [".claude/settings.json", "src/auth.ts"]);
});

test("a git submodule is not mistaken for a worktree and stays indexed", (t) => {
  const upstream = mkdtempSync(join(tmpdir(), "pi-codemap-submodule-src-"));
  t.after(() => rmSync(upstream, { recursive: true, force: true }));
  git(upstream, "init", "-b", "main");
  git(upstream, "config", "user.email", "test@example.com");
  git(upstream, "config", "user.name", "Test");
  writeFileSync(join(upstream, "lib.ts"), "export function vendoredHelper() {\n  return 1;\n}\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-m", "init");

  const root = repoWithNestedWorktree(t);
  execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "libs/dep"], {
    cwd: root,
    stdio: "ignore",
  });

  const paths = scanRepo(root).files.map((file) => file.relPath).sort();

  // `.git` is a file in a submodule too — the ignore rule for the `.git` *directory* misses both, so
  // detection must distinguish them: the worktree is a duplicate, the submodule is distinct code.
  assert.ok(paths.includes("libs/dep/lib.ts"), `submodule content stays indexed, got ${paths.join(", ")}`);
  assert.ok(!paths.some((path) => path.startsWith(".claude/worktrees/")), "worktree copy stays out");
});

test("search returns one hit per symbol once a nested worktree exists", (t) => {
  const root = repoWithNestedWorktree(t);
  indexRepo({ cwd: root, approve: true });

  const hits = searchCodeMap({ query: "registerCurated", cwd: root, limit: 10 })
    .filter((row) => row.path.endsWith("auth.ts"))
    .map((row) => row.path);

  assert.deepEqual(hits, ["src/auth.ts"], "the duplicate at .claude/worktrees/x/src/auth.ts is gone");
});

test("re-indexing prunes worktree copies an earlier index already stored", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-worktree-prune-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "auth.ts"), "export function registerCurated(name: string) {\n  return name;\n}\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "init");

  // Reproduce a pre-fix index: a plain copy of the tree is not a registered worktree, so it indexes
  // as ordinary content exactly the way the duplicated worktree used to.
  mkdirSync(join(root, ".claude", "worktrees", "x", "src"), { recursive: true });
  writeFileSync(join(root, ".claude", "worktrees", "x", "src", "auth.ts"), "export function registerCurated(name: string) {\n  return name;\n}\n");
  const polluted = indexRepo({ cwd: root, approve: true });
  assert.equal(polluted.indexed, 2, "the pre-fix index holds both copies");

  // Turn that copy into a real worktree and re-index.
  rmSync(join(root, ".claude", "worktrees", "x"), { recursive: true, force: true });
  git(root, "worktree", "add", join(root, ".claude", "worktrees", "x"));
  const cleaned = indexRepo({ cwd: root });

  assert.equal(cleaned.removed, 1, "the stale duplicate is pruned, not left behind");
  const hits = searchCodeMap({ query: "registerCurated", cwd: root, limit: 10 });
  assert.ok(!hits.some((row) => row.path.startsWith(".claude/")), "no worktree paths remain in the index");
});
