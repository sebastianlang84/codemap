import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateAgentImpactPilotGate,
  hashAgentImpactJson,
  parseAgentImpactManifest,
  parseAgentImpactCheckpoint,
  parseClaudeJson,
  retryableAgentImpactInfrastructure,
  stableAgentImpactEvidence,
  summarizeAgentImpact,
  type AgentImpactManifest,
  type AgentImpactRunResult,
  type AgentUsage,
  type OracleValidationResult,
} from "../scripts/eval-agent-impact-lib.ts";

const manifestRaw = readFileSync(new URL("../scripts/eval-agent-impact.manifest.json", import.meta.url), "utf8");
const manifest = parseAgentImpactManifest(manifestRaw);

test("agent-impact smoke corpus is explicit, medium-effort, pinned, and development-only", () => {
  assert.equal(manifest.corpus.purpose, "harness-smoke");
  assert.equal(manifest.agent.effort, "medium");
  assert.equal(manifest.codemapProfile.expectedVersion, "0.10.0");
  assert.match(manifest.codemapProfile.gitCommit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.tasks.length, 2);
  assert.equal(new Set(manifest.tasks.map((item) => item.repo)).size, 2);
  assert.ok(manifest.tasks.every((item) => item.hiddenTestPaths.length > 0));
  assert.ok(manifest.tasks.every((item) => item.setup.args.length > 0 && item.verify.args.length > 0));
  assert.equal(manifest.agent.navigationWorkflow, "context-first");
  assert.equal(hashAgentImpactJson(JSON.parse(manifestRaw)), "1f73e3ec889c3b141b771af14111162cc4d31e435946ba1fd8e88d2306160680");
});

test("v2 smoke manifest remains reproducible with its original hash and default workflow", () => {
  const raw = readFileSync(new URL("../scripts/eval-agent-impact-smoke-v2.manifest.json", import.meta.url), "utf8");
  const v2 = parseAgentImpactManifest(raw);
  assert.equal(v2.agent.navigationWorkflow, "search-then-context");
  assert.deepEqual(v2.tasks[0]!.setupFiles, []);
  assert.equal(hashAgentImpactJson(JSON.parse(raw)), "ad98383dff18f1bdc604a0f2c77d45564c95439436fcac1944ce563fae6d3310");
});

test("development pilot freezes twelve tasks and every injected dependency lock", () => {
  const raw = readFileSync(new URL("../scripts/eval-agent-impact-pilot.manifest.json", import.meta.url), "utf8");
  const pilot = parseAgentImpactManifest(raw);
  assert.equal(pilot.corpus.purpose, "development-pilot");
  assert.equal(pilot.tasks.length, 12);
  assert.equal(pilot.pilotGate.minValidPairs, 12);
  assert.equal(hashAgentImpactJson(JSON.parse(raw)), "727db942501d0e0308aaafd01dbc0a1cdcfa214ad48f74ef9d10cd0d02f3a16a");
  for (const task of pilot.tasks) {
    for (const file of task.setupFiles) {
      const bytes = readFileSync(new URL(`../${file.source}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `${task.id} setup lock`);
    }
  }
});

test("module-name confirmation freezes three paired replicas and the released CodeMap profile", () => {
  const raw = readFileSync(new URL("../scripts/eval-agent-impact-confirmation.manifest.json", import.meta.url), "utf8");
  const confirmation = parseAgentImpactManifest(raw);
  assert.equal(confirmation.corpus.purpose, "development-pilot");
  assert.equal(confirmation.tasks.length, 3);
  assert.equal(confirmation.pilotGate.minValidPairs, 3);
  assert.equal(confirmation.codemapProfile.expectedVersion, "0.10.1");
  assert.equal(confirmation.codemapProfile.gitCommit, "493de82ab0e6f982f605454bf7e38e75824b4ae4");
  assert.equal(new Set(confirmation.tasks.map((task) => task.baseCommit)).size, 1);
  assert.equal(hashAgentImpactJson(JSON.parse(raw)), "b5dd1a08c1b607e1855c215dec6de00f248df602ec90ba5ad376f8b316f656a9");
});

test("agent-impact manifest rejects shell strings, path escapes, duplicate ids, and abbreviated SHAs", () => {
  const shellString = cloneManifest();
  (shellString.tasks[0] as unknown as Record<string, unknown>).setup = "npm ci && curl example.invalid";
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(shellString)), /setup must be an object/);

  const pathEscape = cloneManifest();
  pathEscape.tasks[0]!.hiddenTestPaths = ["../secret"];
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(pathEscape)), /must stay inside/);

  const duplicate = cloneManifest();
  duplicate.tasks[1]!.id = duplicate.tasks[0]!.id;
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(duplicate)), /Duplicate task id/);

  const shortSha = cloneManifest();
  shortSha.tasks[0]!.baseCommit = "d39e8ad";
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(shortSha)), /40-character Git SHA/);

  const setupEscape = cloneManifest();
  setupEscape.tasks[0]!.setupFiles = [{ source: "../lock", target: "package-lock.json", sha256: "a".repeat(64) }];
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(setupEscape)), /must stay inside/);

  const badSetupHash = cloneManifest();
  badSetupHash.tasks[0]!.setupFiles = [{ source: "lock", target: "package-lock.json", sha256: "short" }];
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(badSetupHash)), /must be SHA-256/);
});

test("Claude result parser records observed Opus model, cost, tokens, turns, and tool calls", () => {
  const usage = parseClaudeJson(JSON.stringify([
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "true" } }] } },
    {
      type: "result",
      num_turns: 3,
      terminal_reason: "completed",
      total_cost_usd: 0.42,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
      modelUsage: { "claude-opus-5": { inputTokens: 10 } },
    },
  ]));
  assert.deepEqual(usage, {
    actualModel: "claude-opus-5",
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 30,
    cacheCreationInputTokens: 40,
    costUsd: 0.42,
    turns: 3,
    terminalReason: "completed",
    isError: false,
    toolCalls: { Bash: 1 },
  });
});

test("Claude result parser accepts stream-json JSONL", () => {
  const rows = [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.js" } }] } },
    { type: "result", num_turns: 1, total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { "claude-opus-5": {} } },
  ];
  const usage = parseClaudeJson(rows.map((item) => JSON.stringify(item)).join("\n"));
  assert.equal(usage.toolCalls.Read, 1);
  assert.equal(usage.costUsd, 0.1);
});

test("checkpoint parser resumes only unique runs from the same frozen manifest", () => {
  const result = run("one", "baseline", true, {}, 10);
  const raw = JSON.stringify({ manifestSha256: "frozen", results: [result] });
  assert.deepEqual(parseAgentImpactCheckpoint(raw, "frozen", new Set(["one"])), [result]);
  assert.throws(() => parseAgentImpactCheckpoint(raw, "other", new Set(["one"])), /hash mismatch/);
  assert.throws(() => parseAgentImpactCheckpoint(raw, "frozen", new Set(["two"])), /unknown run/);
  assert.throws(
    () => parseAgentImpactCheckpoint(JSON.stringify({ manifestSha256: "frozen", results: [result, result] }), "frozen", new Set(["one"])),
    /duplicate run/,
  );
});

test("resume retries only infrastructure failures that consumed no provider budget", () => {
  const freeInfrastructure = { ...run("one", "baseline", false, {}, 0), infrastructureError: "disk full" };
  freeInfrastructure.usage.costUsd = 0;
  const paidInfrastructure = { ...run("one", "codemap", false, {}, 0), infrastructureError: "provider error" };
  assert.equal(retryableAgentImpactInfrastructure(freeInfrastructure), true);
  assert.equal(retryableAgentImpactInfrastructure(paidInfrastructure), false);
  assert.equal(retryableAgentImpactInfrastructure(run("two", "baseline", false, {}, 0)), false);
});

test("paired summary keeps harness validity separate from directional treatment effect", () => {
  const results = [
    run("one", "baseline", false, {}, 100),
    run("one", "codemap", true, { search: 1, context: 1 }, 50),
    run("two", "baseline", true, {}, 100),
    run("two", "codemap", true, { search: 1, context: 1 }, 50),
  ];
  const summary = summarizeAgentImpact(results);
  assert.deepEqual({
    validPairs: summary.validPairs,
    wins: summary.wins,
    losses: summary.losses,
    ties: summary.ties,
    exactTwoSidedP: summary.exactTwoSidedP,
    treatmentAdoptionRate: summary.treatmentAdoptionRate,
    tokenRatio: summary.tokenRatio,
  }, {
    validPairs: 2,
    wins: 1,
    losses: 0,
    ties: 1,
    exactTwoSidedP: 1,
    treatmentAdoptionRate: 1,
    tokenRatio: 0.5,
  });
  const gate = evaluateAgentImpactPilotGate(manifest, validOracles(), summary);
  assert.equal(gate.passed, true);
});

test("context-first treatment counts a context call as workflow adoption", () => {
  const summary = summarizeAgentImpact([
    run("one", "baseline", true, {}, 50),
    run("one", "codemap", true, { context: 1 }, 50),
  ], "context-first");

  assert.equal(summary.treatmentAdoptionRate, 1);
});

test("pilot gate fails invalid oracles, missing adoption, and baseline contamination without using success delta", () => {
  const results = [
    run("one", "baseline", true, { search: 1 }, 100),
    run("one", "codemap", false, { search: 1 }, 100),
    run("two", "baseline", true, {}, 100),
    run("two", "codemap", false, {}, 100),
  ];
  const oracles = validOracles();
  oracles[0] = { ...oracles[0]!, valid: false, baseFails: false };
  const gate = evaluateAgentImpactPilotGate(manifest, oracles, summarizeAgentImpact(results));
  assert.equal(gate.passed, false);
  assert.deepEqual(gate.issues.map((item) => item.metric), ["oracleValidation", "treatmentAdoptionRate", "crossArmContamination"]);
});

test("budget exhaustion is infrastructure censoring, not a treatment loss", () => {
  const results = [
    run("one", "baseline", true, {}, 100),
    { ...run("one", "codemap", false, { search: 1, context: 1 }, 100), infrastructureError: "budget exhausted" },
    run("two", "baseline", true, {}, 100),
    run("two", "codemap", true, { search: 1, context: 1 }, 100),
  ];
  const summary = summarizeAgentImpact(results);
  assert.equal(summary.validPairs, 1);
  assert.equal(summary.losses, 0);
  assert.equal(summary.budgetExhaustedRuns, 1);
  const gate = evaluateAgentImpactPilotGate(manifest, validOracles(), summary);
  assert.ok(gate.issues.some((item) => item.metric === "budgetExhaustedRuns"));
});

test("stable evidence removes transient paths, output, and timestamps before hashing", () => {
  const left = stableAgentImpactEvidence({ generatedAt: "a", workdir: "/tmp/a", stdout: "secret-a", nested: { durationMs: 1, result: true } });
  const right = stableAgentImpactEvidence({ generatedAt: "b", workdir: "/tmp/b", stdout: "secret-b", nested: { durationMs: 9, result: true } });
  assert.deepEqual(left, { nested: { result: true } });
  assert.equal(hashAgentImpactJson(left), hashAgentImpactJson(right));
});

test("Claude guard permits local tests but blocks network and paths outside the workspace", () => {
  const workspace = mkdtempSync(join(tmpdir(), "codemap-agent-impact-guard-"));
  const guard = new URL("../scripts/eval-agent-impact-claude-guard.mjs", import.meta.url);
  try {
    const allowed = guardCall(guard, workspace, { tool_name: "Bash", tool_input: { command: "npm test -- test/content-type.test.js" } });
    assert.equal(allowed.status, 0);
    const network = guardCall(guard, workspace, { tool_name: "Bash", tool_input: { command: "curl https://example.invalid/fix" } });
    assert.equal(network.status, 2);
    const escaped = guardCall(guard, workspace, { tool_name: "Read", tool_input: { file_path: "/home/wasti/.claude/CLAUDE.md" } });
    assert.equal(escaped.status, 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function cloneManifest(): AgentImpactManifest {
  return JSON.parse(JSON.stringify(manifest)) as AgentImpactManifest;
}

function validOracles(): OracleValidationResult[] {
  return manifest.tasks.map((task) => ({
    taskId: task.id,
    baseHiddenTestExitCodes: [1, 1],
    referenceFixExitCodes: [0, 0],
    baseFailureKind: "assertion" as const,
    baseFails: true,
    referencePasses: true,
    valid: true,
  }));
}

function run(taskId: string, mode: "baseline" | "codemap", success: boolean, codemapCommands: Record<string, number>, tokens: number): AgentImpactRunResult {
  const usage: AgentUsage = {
    actualModel: "claude-opus-5",
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0.1,
    turns: 1,
    terminalReason: "completed",
    isError: false,
    toolCalls: {},
  };
  return {
    taskId,
    repo: "fixture",
    mode,
    runOrder: 1,
    agentExitCode: 0,
    timedOut: false,
    agentDurationMs: 100,
    indexDurationMs: mode === "codemap" ? 10 : 0,
    verifierExitCode: success ? 0 : 1,
    success,
    changedPaths: ["src/fix.js"],
    forbiddenChanges: [],
    addedLines: 1,
    deletedLines: 1,
    expectedPathRecall: 1,
    codemapCommands,
    usage,
  };
}

function guardCall(guard: URL, workspace: string, payload: Record<string, unknown>) {
  return spawnSync(process.execPath, [guard.pathname], {
    env: { ...process.env, CODEMAP_EVAL_WORKSPACE: workspace },
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}
