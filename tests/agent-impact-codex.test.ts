import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexArguments, codexContainerArgs, codexContainerEnv, parseCodexJson, prepareCodexHome, redactCodexAuth } from "../scripts/eval-agent-impact-codex.ts";
import { parseAgentImpactManifest, summarizeAgentImpact, retryableAgentImpactInfrastructure } from "../scripts/eval-agent-impact-lib.ts";

const manifest = parseAgentImpactManifest(readFileSync("scripts/eval-agent-impact-luna.manifest.json", "utf8"));
const previous = parseAgentImpactManifest(readFileSync("scripts/eval-agent-impact-optional.manifest.json", "utf8"));

test("Luna preserves tasks and candidate; costs remain unavailable", () => {
  assert.deepEqual(manifest.tasks, previous.tasks);
  assert.deepEqual(manifest.codemapProfile, previous.codemapProfile);
  assert.equal(manifest.agent.model, "gpt-5.6-luna");
  assert.equal(manifest.agent.effort, "high");
  assert.ok(codexArguments(manifest.agent.model, "/tmp/fixture", "medium").includes('model_reasoning_effort="medium"'));
  assert.equal(manifest.agent.maxBudgetUsdPerRun, null);
  assert.equal(manifest.efficiencyGate!.maxCostRatio, null);
  assert.equal(manifest.efficiencyGate!.maxTokenRatio, .85);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/eval-agent-impact.ts", "--manifest", "scripts/eval-agent-impact-luna.manifest.json", "--dry-run"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const plan = JSON.parse(run.stdout);
  assert.equal(plan.plannedRuns, 16);
  assert.equal(plan.worstCaseBudgetUsd, null);
});

const output = (usage: object) => [
  { type: "thread.started", thread_id: "fixture" },
  { type: "item.completed", item: { type: "command_execution", command: "npm test" } },
  { type: "turn.completed", usage },
].map(event => JSON.stringify(event)).join("\n");

test("Codex accounting does not double-count cache or reasoning or invent cost/model evidence", () => {
  const usage = parseCodexJson(output({ input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 100, output_tokens: 200, reasoning_output_tokens: 150 }), "gpt-5.6-luna");
  assert.equal(usage.inputTokens, 300);
  assert.equal(usage.cacheReadInputTokens, 600);
  assert.equal(usage.cacheCreationInputTokens, 100);
  assert.equal(usage.outputTokens, 200);
  assert.equal(usage.costUsd, null);
  assert.equal(usage.actualModel, "unknown");
  assert.equal(usage.requestedModel, "gpt-5.6-luna");
  assert.equal(usage.toolCalls.command_execution, 1);
  const hostFailure = JSON.stringify({ type: "item.completed", item: { type: "error", message: "Code Mode is unavailable: host executable was not found" } });
  assert.equal(parseCodexJson(hostFailure + "\n" + output({ input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 }), "gpt-5.6-luna").isError, true);
  const run = { usage, infrastructureError: "provider parse" } as Parameters<typeof retryableAgentImpactInfrastructure>[0];
  assert.equal(retryableAgentImpactInfrastructure(run), false);
  assert.equal(summarizeAgentImpact([{ ...run, taskId: "one", mode: "baseline", codemapCommands: {} }]).totalCostUsd, null);
  assert.throws(() => parseCodexJson(output({ input_tokens: 1, cached_input_tokens: 2, output_tokens: 0 }), "gpt-5.6-luna"), /exceed/);
  assert.throws(() => parseCodexJson('{"type":"turn.failed"}', "gpt-5.6-luna"), /completed turn/);
});

test("Codex uses isolated private login copy and explicit model, sandbox and configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "codemap-codex-test-"));
  try {
    const token = "fake-token-".repeat(10);
    writeFileSync(join(root, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: token } }));
    const env = prepareCodexHome(join(root, "attempt"), root);
    assert.equal(statSync(join(env.CODEX_HOME!, "auth.json")).mode & 0o777, 0o600);
    assert.equal(redactCodexAuth(`output ${token}`, env.CODEX_HOME!), "output [REDACTED]");
    writeFileSync(join(env.CODEX_HOME!, "auth.json"), "{}");
    assert.match(readFileSync(join(root, "auth.json"), "utf8"), /chatgpt/);
    const args = codexArguments(manifest.agent.model, root, manifest.agent.effort);
    assert.ok(args.includes("gpt-5.6-luna"));
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.includes("workspace-write"));
    assert.ok(args.includes("sandbox_workspace_write.network_access=true"));
    assert.ok(args.includes('web_search="disabled"'));
    assert.ok(args.includes('model_reasoning_effort="high"'));
    writeFileSync(join(root, "auth.json"), '{"auth_mode":"apikey"}');
    assert.throws(() => prepareCodexHome(join(root, "other"), root), /ChatGPT login/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("filesystem container hides host worktrees while allowing attempt and system runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "codemap-bwrap-test-"));
  const profile = mkdtempSync(join(tmpdir(), "codemap-profile-test-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "codemap"), "#!/bin/sh\necho fixture\n", { mode: 0o700 });
    const args = codexContainerArgs("/usr/bin/node", root, profile);
    const result = spawnSync("bwrap", [...args, "-e", `const fs=require('fs'); if(fs.existsSync('/home/wasti/dev/codemap'))process.exit(2); fs.writeFileSync(${JSON.stringify(join(root, "written"))},'ok'); const cp=require('child_process'); if(cp.execFileSync('/bin/bash',['-lc','codemap'],{encoding:'utf8'}).trim()!=='fixture')process.exit(3)`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, "written"), "utf8"), "ok");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true }); }
});

// Uses the installed CLI without model calls; CI without Codex skips this host check.
test("Codex sandbox permits local HTTP regression tests only with network enabled", t => {
  const binary = join(process.env.HOME!, ".local/bin/codex");
  if (!existsSync(binary)) { t.skip("Codex CLI not installed"); return; }
  const root = mkdtempSync(join(tmpdir(), "codemap-socket-test-"));
  const profile = mkdtempSync(join(tmpdir(), "codemap-profile-test-"));
  try {
    const probe = "const s=require('node:http').createServer((q,r)=>r.end('ok'));s.on('error',()=>process.exit(1));s.listen(0,'127.0.0.1',async()=>{const r=await fetch('http://127.0.0.1:'+s.address().port);console.log(await r.text());s.close()})";
    for (const enabled of [false, true]) {
      const result = spawnSync("bwrap", [...codexContainerArgs(binary, root, profile),
        "sandbox", "-P", "fixture", "-C", root,
        "-c", 'permissions.fixture.extends=":workspace"',
        "-c", `permissions.fixture.network.enabled=${enabled}`,
        "--", process.execPath, "-e", probe,
      ], { cwd: root, env: codexContainerEnv({ PATH: "/usr/bin:/bin" }), encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, enabled ? 0 : 1, result.stderr);
      if (enabled) assert.equal(result.stdout.trim(), "ok");
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true }); }
});
