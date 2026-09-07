import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureAgentImpactPatch, createAgentImpactTraceDir, writeAgentImpactPatch, writeAgentImpactTrace } from "../scripts/eval-agent-impact-trace.ts";

test("original patch reconstructs tracked, staged and new agent files before hidden tests replace them", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-patch-test-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git("init", "--quiet");
    writeFileSync(join(root, "test.js"), "original\n");
    git("add", "test.js");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "base");
    writeFileSync(join(root, "test.js"), "agent test\n");
    git("add", "test.js");
    writeFileSync(join(root, "new file.js"), "agent new test\n");
    const patch = captureAgentImpactPatch(root);
    assert.match(patch, /agent test/);
    assert.match(patch, /agent new test/);
    writeAgentImpactPatch(root, 1, patch);
    assert.throws(() => writeAgentImpactPatch(root, 1, "overwrite"), /EEXIST/);
    assert.equal(statSync(join(root, "run-1-original.patch")).mode & 0o777, 0o600);
    writeFileSync(join(root, "test.js"), "hidden verifier replacement\n");
    assert.equal(readFileSync(join(root, "run-1-original.patch"), "utf8"), patch);
    rmSync(join(root, "new file.js"));
    git("reset", "--hard", "HEAD");
    const restored = spawnSync("git", ["apply", "-"], { cwd: root, input: patch, encoding: "utf8" });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(readFileSync(join(root, "test.js"), "utf8"), "agent test\n");
    assert.equal(readFileSync(join(root, "new file.js"), "utf8"), "agent new test\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
