import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { indexRepo } from "../src/core/indexer.ts";
import { searchCodeMap } from "../src/core/search.ts";

const helper = fileURLToPath(new URL("./eval-search-tool-comparison.ts", import.meta.url));

test("comparison adapters share one pool and preserve native search", (t) => {
  const base = mkdtempSync(join(tmpdir(), "codemap-tool-adapter-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const state = join(base, "state");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(join(root, "src", "value.ts"), 'export function computeValue() { return "value"; }\n');
  writeFileSync(join(root, "docs", "value.md"), "# Value\nvalue value value value compute\n");
  indexRepo({ cwd: root, stateDir: state, approve: true });
  const query = "compute value";
  const call = (profile: string) => JSON.parse(execFileSync(process.execPath,
    ["--experimental-strip-types", helper], {
      input: JSON.stringify({ profile, root, state, query, limit: 10 }), encoding: "utf8",
    }));
  const bm25 = call("bm25");
  const scored = call("codemap_fts");
  assert.ok(bm25.pool.length >= 2);
  assert.deepEqual(bm25.pool, scored.pool);
  const expectedPaths = [...new Set(bm25.pool.map((row: { path: string }) => row.path))];
  assert.deepEqual(bm25.candidates.map((row: { path: string }) => row.path), expectedPaths);
  assert.deepEqual(call("bm25").candidates, bm25.candidates);
  assert.deepEqual(call("codemap").candidates, searchCodeMap({ cwd: root, stateDir: state, query, limit: 10 }));
  assert.deepEqual(bm25.indexedPaths, ["docs/value.md", "src/value.ts"]);
  const bad = spawnSync(process.execPath, ["--experimental-strip-types", helper], {
    input: JSON.stringify({ profile: "unknown", root, state, query }), encoding: "utf8",
  });
  assert.notEqual(bad.status, 0);
});

test("query planning requires no repository or writable state", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", helper], {
    input: JSON.stringify({ profile: "plan", query: "calculateValue result" }), encoding: "utf8",
  }));
  assert.ok(result.terms.includes("calculatevalue"));
  assert.ok(result.ftsQuery.includes('"calculatevalue"'));
});
