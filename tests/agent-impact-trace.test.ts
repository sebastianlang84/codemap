import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentImpactTraceDir, writeAgentImpactTrace } from "../scripts/eval-agent-impact-trace.ts";

test("traces preserve tool events and partial provider failures without overwriting paid runs", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-trace-test-"));
  try {
    const dir = createAgentImpactTraceDir(root, "frozen-manifest");
    const stdout = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/a.ts"}}]}}\n{"partial":';
    const trace = { taskId: "task", mode: "baseline", runOrder: 1, agentDurationMs: 100,
      indexDurationMs: 0, status: 124, timedOut: true, stdout, stderr: "provider timeout" };
    writeAgentImpactTrace(dir, trace);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "run-1.json"), "utf8")), trace);
    assert.equal(readFileSync(join(dir, "manifest-sha256.txt"), "utf8"), "frozen-manifest\n");
    assert.throws(() => writeAgentImpactTrace(dir, { ...trace, stdout: "replacement" }), /EEXIST/);
    assert.notEqual(createAgentImpactTraceDir(root, "frozen-manifest"), dir);
    if (process.platform !== "win32") {
      assert.equal(statSync(dir).mode & 0o777, 0o700);
      assert.equal(statSync(join(dir, "run-1.json")).mode & 0o777, 0o600);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("trace destination rejects worktrees, including symlinked paths", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-trace-test-"));
  try {
    const repo = join(root, "repo");
    const init = spawnSync("git", ["init", repo], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    assert.throws(() => createAgentImpactTraceDir(join(repo, "new", "traces"), "hash"), /outside Git/);
    if (process.platform !== "win32") {
      symlinkSync(repo, join(root, "alias"));
      assert.throws(() => createAgentImpactTraceDir(join(root, "alias", "traces"), "hash"), /outside Git/);
    }
    assert.deepEqual(readdirSync(repo), [".git"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dry-run accepts trace option without creating traces or launching agents", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-trace-test-"));
  try {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/eval-agent-impact.ts",
      "--dry-run", "--trace-dir", join(root, "traces")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).plannedRuns, 4);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
