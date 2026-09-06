import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import type { AgentUsage } from "./eval-agent-impact-lib.ts";

export function prepareCodexHome(root: string, sourceHome: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  const codexHome = join(root, "codex-home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  // Private disposable copy; refresh cannot overwrite the user's login.
  const auth = join(codexHome, "auth.json");
  const source = JSON.parse(readFileSync(join(sourceHome, "auth.json"), "utf8"));
  if (source.auth_mode !== "chatgpt") throw new Error("Codex comparison requires existing ChatGPT login, not API-key billing");
  copyFileSync(join(sourceHome, "auth.json"), auth);
  chmodSync(auth, 0o600);
  return { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };
}

export function codexArguments(model: string, workspace: string, effort: "medium" | "high"): string[] {
  return ["exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json",
    "--model", model, "--sandbox", "workspace-write", "--cd", workspace, "--add-dir", dirname(workspace),
    "-c", `model_reasoning_effort="${effort}"`, "-c", 'approval_policy="never"',
    "-c", 'cli_auth_credentials_store="file"',
    "-c", 'sandbox_workspace_write.network_access=true',
    "-c", 'web_search="disabled"',
    "-c", 'project_doc_max_bytes=0',
    "-c", 'skills.include_instructions=false',
    "-c", 'suppress_unstable_features_warning=true',
    "-c", 'shell_environment_policy.inherit="all"',
    "--enable", "skip_host_skill_discovery",
    ...["plugins", "apps", "memories", "hooks", "skill_search", "skill_mcp_dependency_install", "multi_agent"].flatMap(feature => ["--disable", feature]),
    "-"];
}

// Local HTTP regression tests need socket access in both arms.
// Only this attempt, the pinned CodeMap profile, system runtime and Codex executable are visible.
export function codexContainerArgs(binary: string, root: string, profile: string): string[] {
  const executable = realpathSync(binary);
  mkdirSync(join(root, "bin"), { recursive: true });
  const ripgrep = (process.env.PATH ?? "").split(":").map(path => join(path, "rg")).find(existsSync);
  if (!ripgrep) throw new Error("ripgrep is required for both evaluation arms");
  copyFileSync(realpathSync(ripgrep), join(root, "bin", "rg"));
  chmodSync(join(root, "bin", "rg"), 0o700);
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "codex-home"), { recursive: true });
  return ["--die-with-parent", "--unshare-pid", "--proc", "/proc", "--dev", "/dev",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    "--ro-bind", "/etc", "/etc", "--tmpfs", "/tmp",
    "--bind", root, root, "--ro-bind", profile, profile,
    "--bind", join(root, "home"), "/home/codemap",
    "--bind", join(root, "codex-home"), "/home/codemap/.codex",
    "--ro-bind", join(root, "bin"), "/usr/local/bin",
    "--ro-bind", dirname(executable), dirname(executable), "--", executable];
}

export function parseCodexJson(raw: string, requestedModel: string): AgentUsage {
  const events = raw.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const completed = events.filter(event => event.type === "turn.completed");
  if (completed.length !== 1) throw new Error("Codex output requires exactly one completed turn");
  const usage = completed[0].usage;
  for (const key of ["input_tokens", "cached_input_tokens", "output_tokens"]) {
    if (!Number.isSafeInteger(usage?.[key]) || usage[key] < 0) throw new Error(`Invalid Codex ${key}`);
  }
  const cacheWrite = usage.cache_write_input_tokens ?? 0;
  if (!Number.isSafeInteger(cacheWrite) || cacheWrite < 0) throw new Error("Invalid Codex cache writes");
  if (usage.cached_input_tokens + cacheWrite > usage.input_tokens) throw new Error("Codex cached tokens exceed total input");
  const toolCalls: Record<string, number> = {};
  for (const event of events) {
    if (event.type === "item.completed" && event.item?.type === "command_execution") {
      toolCalls.command_execution = (toolCalls.command_execution ?? 0) + 1;
    }
  }
  return {
    actualModel: "unknown",
    requestedModel,
    modelEvidence: "requested-only",
    // Codex input_tokens includes cached input; the shared total adds cache reads separately.
    inputTokens: usage.input_tokens - usage.cached_input_tokens - cacheWrite,
    cacheReadInputTokens: usage.cached_input_tokens,
    cacheCreationInputTokens: cacheWrite,
    outputTokens: usage.output_tokens,
    costUsd: null,
    turns: completed.length,
    terminalReason: "completed",
    isError: events.some(event => event.type === "error" || event.type === "turn.failed" || (event.item?.type === "error" && !event.item.message?.startsWith("Under-development features enabled:"))),
    toolCalls,
  };
}

export function redactCodexAuth(output: string, home: string): string {
  const auth: unknown = JSON.parse(readFileSync(join(home, "auth.json"), "utf8"));
  function redact(value: unknown): void {
    if (typeof value === "string" && value.length > 32) output = output.replaceAll(value, "[REDACTED]");
    else if (value && typeof value === "object") Object.values(value).forEach(redact);
  }
  redact(auth);
  return output;
}

export function codexContainerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, HOME: "/home/codemap", USERPROFILE: "/home/codemap", CODEX_HOME: "/home/codemap/.codex" };
}


export function verifyCodexSandbox(binary: string, root: string, workspace: string, profile: string, env: NodeJS.ProcessEnv, treatment: boolean): void {
  const probe = `const cp=require('node:child_process');
    cp.execFileSync('/bin/bash',['-lc','rg --version && rg --files | head -1 && node --version && npm --version']);
    if (${treatment}) cp.execFileSync('/bin/bash',['-lc','codemap status --json']);
    const s=require('node:http').createServer((q,r)=>r.end('ok'));
    s.on('error',()=>process.exit(1));
    s.listen(0,'127.0.0.1',async()=>{try{const r=await fetch('http://127.0.0.1:'+s.address().port);if(await r.text()!=='ok')process.exitCode=1;}finally{s.close()}});`;
  const result = spawnSync("bwrap", [...codexContainerArgs(binary, root, profile),
    "sandbox", "-P", "fixture", "-C", workspace,
    "-c", 'permissions.fixture.extends=":workspace"',
    "-c", 'permissions.fixture.network.enabled=true',
    "--", process.execPath, "-e", probe,
  ], { cwd: workspace, env: codexContainerEnv({ ...env, CODEMAP_CALL_LOG: join(root, "preflight-calls.log") }), encoding: "utf8", timeout: 20000 });
  if (result.status !== 0) throw new Error("Codex sandbox preflight failed: " + (result.stderr ?? "").slice(-2000));
}
