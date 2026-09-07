import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderCuratedContext, summarizeContextDiagnostic } from "../scripts/eval-agent-impact-context.ts";
import { hashAgentImpactJson, parseAgentImpactManifest, parseAgentImpactCheckpoint, type AgentImpactRunResult } from "../scripts/eval-agent-impact-lib.ts";

const raw = JSON.parse(readFileSync(new URL("../scripts/eval-agent-impact-location.manifest.json", import.meta.url), "utf8"));
const sha = (source: string) => createHash("sha256").update(source).digest("hex");
const task = { ...raw.tasks[0], sourceContext: [{ path: "lib/response.js", start: 2, end: 3, sha256: sha("body\nend\n") }] };

test("context diagnostic freezes all four prior tasks with base excerpts and medium effort", () => {
  const text = readFileSync(new URL("../scripts/eval-agent-impact-context.manifest.json", import.meta.url), "utf8");
  const manifest = parseAgentImpactManifest(text);
  assert.equal(hashAgentImpactJson(JSON.parse(text)), "3e26ff97ef090cfb603b4aba81bcd834c850da990686022aab491e33baba2c38");
  assert.equal(manifest.agent.effort, "medium");
  assert.equal(manifest.diagnostic, "curated-context");
  assert.deepEqual(manifest.tasks.map(({ sourceContext, ...task }) => task), raw.tasks);
});

test("curated prompt preserves only frozen base lines and rejects changed or oversized source", () => {
  const prompt = renderCuratedContext(task, () => "header\nbody\nend\nsecret fix\n");
  assert.match(prompt, /lib\/response.js:2-3\n```\nbody\nend\n```/);
  assert.doesNotMatch(prompt, /header|secret fix/);
  assert.throws(() => renderCuratedContext(task, () => "header\nchanged\nend\n"), /hash mismatch/);
  assert.throws(() => renderCuratedContext(task, () => "header\n"), /exceeds base/);
  const source = "x".repeat(16384) + "\n";
  assert.throws(() => renderCuratedContext({ ...task, sourceContext: [{ path: "x", start: 1, end: 1, sha256: sha(source) }] }, () => source), /16 KiB/);
});

test("curated arm requires explicit diagnostic and checked ranges for every task", () => {
  const manifest = { ...raw, tasks: [task], pilotGate: { ...raw.pilotGate, minValidPairs: 1 } };
  assert.throws(() => parseAgentImpactManifest(JSON.stringify(manifest)), /requires a diagnostic/);
  const diagnostic = { ...manifest, diagnostic: "curated-context" };
  assert.equal(parseAgentImpactManifest(JSON.stringify(diagnostic)).tasks[0]!.sourceContext![0]!.start, 2);
  assert.throws(() => parseAgentImpactManifest(JSON.stringify({ ...diagnostic, tasks: [{ ...task, sourceContext: [] }] })), /every task/);
  assert.throws(() => parseAgentImpactManifest(JSON.stringify({ ...diagnostic, tasks: [{ ...task, sourceContext: [{ ...task.sourceContext[0], start: 4 }] }] })), /range/);
  const checkpoint = JSON.stringify({ manifestSha256: "frozen", results: [{ taskId: "t", mode: "curated" }] });
  assert.throws(() => parseAgentImpactCheckpoint(checkpoint, "frozen", new Set(["t"])), /unknown run/);
  assert.equal(parseAgentImpactCheckpoint(checkpoint, "frozen", new Set(["t"]), new Set(["curated"])).length, 1);
});

test("diagnostic keeps each paired comparison separate and flags incomplete or contaminated triplets", () => {
  const row = (mode: "baseline" | "codemap" | "curated", tokens: number, success: boolean) => ({
    taskId: "t", mode, success, agentDurationMs: tokens, codemapCommands: {},
    usage: { inputTokens: tokens, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: null },
  } as AgentImpactRunResult);
  const rows = [row("baseline", 100, false), row("codemap", 120, true), row("curated", 60, true)];
  const result = summarizeContextDiagnostic(rows, 1);
  assert.equal(result.complete, true);
  assert.equal(result.curatedVsBaseline.tokenRatio, 0.6);
  assert.equal(result.curatedVsCodemap.tokenRatio, 0.5);
  assert.equal(result.codemapVsBaseline.wins, 1);
  assert.equal(result.curatedVsCodemap.ties, 1);
  assert.equal(summarizeContextDiagnostic(rows.slice(0, 2), 1).complete, false);
  assert.equal(summarizeContextDiagnostic(rows.map(row => row.mode === "curated" ? { ...row, infrastructureError: "timeout" } : row), 1).complete, false);
  rows[2]!.codemapCommands = { search: 1 };
  assert.equal(summarizeContextDiagnostic(rows, 1).complete, false);
});
