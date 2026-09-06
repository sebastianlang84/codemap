#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentImpactToken, isolatedAgentImpactClaude, redactAgentImpactToken, withoutClaudeAuth } from "./eval-agent-impact-auth.ts";
import { createAgentImpactTraceDir, writeAgentImpactTrace } from "./eval-agent-impact-trace.ts";

import {
  evaluateAgentImpactPilotGate,
  hashAgentImpactJson,
  parseAgentImpactManifest,
  parseAgentImpactCheckpoint,
  parseClaudeJson,
  retryableAgentImpactInfrastructure,
  stableAgentImpactEvidence,
  summarizeAgentImpact,
  type AgentImpactCommand,
  type AgentImpactManifest,
  type AgentImpactMode,
  type AgentImpactRunResult,
  type AgentImpactTask,
  type AgentUsage,
  type OracleValidationResult,
} from "./eval-agent-impact-lib.ts";

interface ParsedArgs {
  manifestPath: string;
  cacheDir: string;
  taskIds: string[];
  mode: AgentImpactMode | "all";
  approveBudgetUsd?: number;
  validateOnly: boolean;
  dryRun: boolean;
  qualityGate: boolean;
  keepWorkdir: boolean;
  offline: boolean;
  evidenceOutput?: string;
  traceDir?: string;
  resume: boolean;
  help: boolean;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

interface PreparedWorkspace {
  root: string;
  repo: string;
  stateDir: string;
  callLog: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const realHome = homedir();
const claudeGuardPath = join(scriptDir, "eval-agent-impact-claude-guard.mjs");
const defaultManifestPath = join(scriptDir, "eval-agent-impact.manifest.json");
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const manifestRaw = readFileSync(args.manifestPath, "utf8");
const manifest = parseAgentImpactManifest(manifestRaw);
const manifestSha256 = hashAgentImpactJson(JSON.parse(manifestRaw));
const selectedTasks = selectTasks(manifest, args.taskIds);
const modes: AgentImpactMode[] = args.mode === "all" ? ["baseline", "codemap"] : [args.mode];
const plannedRuns = selectedTasks.length * modes.length;
const worstCaseBudgetUsd = round(plannedRuns * manifest.agent.maxBudgetUsdPerRun, 2);

if (args.resume && !args.evidenceOutput) throw new Error("--resume requires --evidence-output");
if (args.evidenceOutput && (selectedTasks.length !== manifest.tasks.length || modes.length !== 2 || args.validateOnly)) {
  throw new Error("Evidence output requires every manifest task in both modes");
}
if (args.evidenceOutput && existsSync(args.evidenceOutput) && !args.resume) {
  throw new Error(`Evidence output already exists; pass --resume to continue: ${args.evidenceOutput}`);
}

if (args.dryRun) {
  console.log(JSON.stringify({
    manifest: manifest.corpus,
    manifestSha256,
    tasks: selectedTasks.map((task) => task.id),
    modes,
    plannedRuns,
    maxBudgetUsdPerRun: manifest.agent.maxBudgetUsdPerRun,
    worstCaseBudgetUsd,
  }, null, 2));
  process.exit(0);
}

if (!args.validateOnly && (args.approveBudgetUsd === undefined || args.approveBudgetUsd < worstCaseBudgetUsd)) {
  throw new Error(`Refusing ${plannedRuns} paid runs with worst-case $${worstCaseBudgetUsd.toFixed(2)}; pass --approve-budget-usd ${worstCaseBudgetUsd.toFixed(2)} or more`);
}

const automationToken = args.validateOnly ? undefined : agentImpactToken(process.env);

mkdirSync(args.cacheDir, { recursive: true });
const traceDir = args.traceDir && !args.validateOnly ? createAgentImpactTraceDir(args.traceDir, manifestSha256) : undefined;
if (traceDir) console.error(`[agent-impact] raw traces: ${traceDir}`);
const runRoot = mkdtempSync(join(tmpdir(), "codemap-agent-impact-"));
if (resolve(runRoot).startsWith(`${resolve(homedir())}/`)) {
  throw new Error(`Agent workspaces must stay outside HOME to avoid ancestor instruction leakage: ${runRoot}`);
}

let report: Record<string, unknown> | undefined;
try {
  const repositoryCaches = new Map(manifest.repositories.map((repo) => [repo.id, ensureRepositoryCache(repo.id, repo.remote, args)]));
  const profile = args.validateOnly ? undefined : ensureCodeMapProfile(manifest, args);
  const oracles = selectedTasks.map((task) => validateOracle(task, repositoryCaches.get(task.repo)!, runRoot, args.keepWorkdir));
  const results = !args.validateOnly && args.resume ? loadCheckpoint(args.evidenceOutput!, manifestSha256, manifest) : [];
  const agentReport = {
    provider: manifest.agent.provider,
    requestedModel: manifest.agent.model,
    effort: manifest.agent.effort,
    navigationWorkflow: manifest.agent.navigationWorkflow,
    claudeCodeVersion: commandVersion(resolveClaudeBin()),
    maxBudgetUsdPerRun: manifest.agent.maxBudgetUsdPerRun,
    isolationConfigSha256: hashAgentImpactJson(claudeSettings()),
  };
  if (!args.validateOnly) {
    const schedule = scheduleRuns(selectedTasks, modes, manifest.corpus.orderSeed);
    const completed = new Set(results.map((item) => runKey(item.taskId, item.mode)));
    if (results.length > 0) console.error(`[agent-impact] resumed ${results.length}/${schedule.length} runs`);
    for (let index = 0; index < schedule.length; index++) {
      const item = schedule[index]!;
      if (completed.has(runKey(item.task.id, item.mode))) continue;
      console.error(`[agent-impact] ${index + 1}/${schedule.length} ${item.task.id}/${item.mode}`);
      results.push({ ...runAgentAttempt({
        task: item.task,
        mode: item.mode,
        runOrder: index + 1,
        manifest,
        repoCache: repositoryCaches.get(item.task.repo)!,
        profileDir: profile!,
        runRoot,
        keepWorkdir: args.keepWorkdir,
      }), authentication: "setup-token" });
      if (args.evidenceOutput) {
        report = buildReport(manifest, manifestSha256, agentReport, plannedRuns, worstCaseBudgetUsd, oracles, results, args.keepWorkdir ? runRoot : undefined);
        writeEvidence(args.evidenceOutput, report);
        console.error(`[agent-impact] checkpoint ${results.length}/${schedule.length}`);
      }
    }
  }
  report = buildReport(manifest, manifestSha256, agentReport, plannedRuns, worstCaseBudgetUsd, oracles, results, args.keepWorkdir ? runRoot : undefined);
  const gate = report.gate as ReturnType<typeof evaluateAgentImpactPilotGate>;
  if (args.evidenceOutput) {
    const stable = writeEvidence(args.evidenceOutput, report);
    console.error(`[agent-impact] evidence ${args.evidenceOutput} sha256=${hashAgentImpactJson(stable)}`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (args.qualityGate && !args.validateOnly && !gate.passed) process.exitCode = 1;
  if (oracles.some((item) => !item.valid)) process.exitCode = 1;
} finally {
  if (!args.keepWorkdir) rmSync(runRoot, { recursive: true, force: true });
  else console.error(`[agent-impact] kept ${runRoot}`);
}

function buildReport(
  manifest: AgentImpactManifest,
  manifestSha256: string,
  agent: Record<string, unknown>,
  plannedRuns: number,
  worstCaseBudgetUsd: number,
  oracles: OracleValidationResult[],
  results: AgentImpactRunResult[],
  workdir?: string,
): Record<string, unknown> {
  const summary = summarizeAgentImpact(results, manifest.agent.navigationWorkflow);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    corpus: manifest.corpus,
    manifestSha256,
    codemapProfile: manifest.codemapProfile,
    agent,
    plannedRuns,
    worstCaseBudgetUsd,
    oracles,
    results,
    summary,
    gate: evaluateAgentImpactPilotGate(manifest, oracles, summary),
    claimBoundary: claimBoundary(manifest.corpus.purpose),
    ...(workdir ? { workdir } : {}),
  };
}

function writeEvidence(path: string, report: Record<string, unknown>): unknown {
  const stable = stableAgentImpactEvidence(report);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(stable, null, 2)}\n`);
  renameSync(temporary, path);
  return stable;
}

function loadCheckpoint(path: string, expectedManifestSha256: string, manifest: AgentImpactManifest): AgentImpactRunResult[] {
  if (!existsSync(path)) return [];
  const loaded = parseAgentImpactCheckpoint(readFileSync(path, "utf8"), expectedManifestSha256, new Set(manifest.tasks.map((task) => task.id)));
  const retained = loaded.filter((result) => !retryableAgentImpactInfrastructure(result));
  const retrying = loaded.length - retained.length;
  if (retrying > 0) console.error(`[agent-impact] retrying ${retrying} zero-cost infrastructure runs`);
  return retained;
}

function runKey(taskId: string, mode: AgentImpactMode): string {
  return `${taskId}\0${mode}`;
}

function validateOracle(task: AgentImpactTask, repoCache: string, parent: string, keepWorkdir: boolean): OracleValidationResult {
  let base: PreparedWorkspace | undefined;
  let fixed: PreparedWorkspace | undefined;
  try {
    base = prepareWorkspace(task, repoCache, parent, `oracle-${task.id}-base`, task.baseCommit);
    fixed = prepareWorkspace(task, repoCache, parent, `oracle-${task.id}-fix`, task.fixCommit);
    applyHiddenTests(task, repoCache, base.repo);
    const baseResults = [runSpec(task.verify, base.repo, baseEnv()), runSpec(task.verify, base.repo, baseEnv())];
    const fixResults = [runSpec(task.verify, fixed.repo, baseEnv()), runSpec(task.verify, fixed.repo, baseEnv())];
    const baseFailureKind = baseResults.some((item) => item.timedOut)
      ? "timeout"
      : baseResults.every((item) => `${item.stdout}\n${item.stderr}`.includes(task.expectedBaseFailure)) ? "assertion" : "other";
    const baseFails = baseResults.every((item) => item.status !== 0 && !item.timedOut);
    const referencePasses = fixResults.every((item) => item.status === 0 && !item.timedOut);
    return {
      taskId: task.id,
      baseHiddenTestExitCodes: baseResults.map((item) => item.status),
      referenceFixExitCodes: fixResults.map((item) => item.status),
      baseFailureKind,
      baseFails,
      referencePasses,
      valid: baseFails && referencePasses && baseFailureKind === "assertion",
      ...((baseResults.some((item) => item.error) || fixResults.some((item) => item.error))
        ? { error: [...baseResults, ...fixResults].map((item) => item.error).filter(Boolean).join("; ") }
        : {}),
    };
  } catch (error) {
    return {
      taskId: task.id,
      baseHiddenTestExitCodes: [null, null],
      referenceFixExitCodes: [null, null],
      baseFailureKind: "other",
      baseFails: false,
      referencePasses: false,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (!keepWorkdir) {
      if (base) rmSync(base.root, { recursive: true, force: true });
      if (fixed) rmSync(fixed.root, { recursive: true, force: true });
    }
  }
}

function runAgentAttempt(options: {
  task: AgentImpactTask;
  mode: AgentImpactMode;
  runOrder: number;
  manifest: AgentImpactManifest;
  repoCache: string;
  profileDir: string;
  runRoot: string;
  keepWorkdir: boolean;
}): AgentImpactRunResult {
  const { task, mode, runOrder, manifest, repoCache, profileDir, runRoot, keepWorkdir } = options;
  let workspace: PreparedWorkspace | undefined;
  let usage = emptyUsage();
  let indexDurationMs = 0;
  try {
    workspace = prepareWorkspace(task, repoCache, runRoot, `run-${runOrder}-${task.id}-${mode}`, task.baseCommit);
    const env = agentEnv(workspace, mode, profileDir);
    if (mode === "codemap") indexDurationMs = prepareCodeMap(workspace, profileDir, env);
    const agentStartedAt = performance.now();
    const child = runClaude(task, mode, manifest, workspace, env);
    const agentDurationMs = Math.round(performance.now() - agentStartedAt);
    if (traceDir) {
      try {
        writeAgentImpactTrace(traceDir, { taskId: task.id, mode, runOrder, agentDurationMs, indexDurationMs, ...child });
      } catch (error) {
        // A diagnostic write failure must not turn a paid attempt into a zero-cost retry.
        console.error(`[agent-impact] TRACE NOT SAVED for run ${runOrder}: ${message(error)}`);
      }
    }
    try {
      usage = parseClaudeJson(child.stdout);
    } catch (error) {
      return failedRun(task, mode, runOrder, workspace.repo, usage, child, agentDurationMs, indexDurationMs, `provider parse: ${message(error)}`);
    }
    const diff = captureDiff(workspace.repo, task);
    applyHiddenTests(task, repoCache, workspace.repo);
    const verifier = runSpec(task.verify, workspace.repo, baseEnv());
    const codemapCommands = readCallLog(workspace.callLog);
    const budgetExhausted = child.status !== 0 && (/budget/i.test(usage.terminalReason) || usage.costUsd >= manifest.agent.maxBudgetUsdPerRun * 0.95);
    const infrastructureError = budgetExhausted
      ? "budget exhausted"
      : child.status !== 0 || child.timedOut || child.error || usage.isError
        ? [child.timedOut ? "agent timeout" : undefined, child.status !== 0 ? `agent exit ${child.status}` : undefined, child.error].filter(Boolean).join("; ") || "provider error"
        : undefined;
    return {
      taskId: task.id,
      repo: task.repo,
      mode,
      runOrder,
      agentExitCode: child.status,
      timedOut: child.timedOut,
      agentDurationMs,
      indexDurationMs,
      verifierExitCode: verifier.status,
      success: child.status === 0 && !infrastructureError && verifier.status === 0 && diff.changedPaths.length > 0 && diff.forbiddenChanges.length === 0,
      ...(infrastructureError ? { infrastructureError } : {}),
      ...diff,
      codemapCommands,
      usage,
    };
  } catch (error) {
    return {
      taskId: task.id,
      repo: task.repo,
      mode,
      runOrder,
      agentExitCode: null,
      timedOut: false,
      agentDurationMs: 0,
      indexDurationMs,
      verifierExitCode: null,
      success: false,
      infrastructureError: message(error),
      changedPaths: [],
      forbiddenChanges: [],
      addedLines: 0,
      deletedLines: 0,
      expectedPathRecall: 0,
      codemapCommands: workspace ? readCallLog(workspace.callLog) : {},
      usage,
    };
  } finally {
    if (workspace && !keepWorkdir) rmSync(workspace.root, { recursive: true, force: true });
  }
}

function runClaude(task: AgentImpactTask, mode: AgentImpactMode, manifest: AgentImpactManifest, workspace: PreparedWorkspace, env: NodeJS.ProcessEnv): CommandResult {
  const claude = resolveClaudeBin();
  const seconds = Math.ceil(manifest.agent.timeoutMs / 1000);
  const prompt = [
    "Implement the requested fix in this repository. Work autonomously. Run the relevant tests.",
    "Do not inspect git history, commits, remotes, or files outside this workspace. Do not commit or push. Do not install dependencies; they are already prepared.",
    mode === "codemap"
      ? treatmentInstruction(manifest)
      : "CodeMap is unavailable in this control run. Use the repository's normal local navigation tools and do not invoke codemap.",
    `Task: ${task.prompt}`,
  ].join("\n\n");
  const values = [
    "--signal=TERM",
    "--kill-after=10s",
    `${seconds}s`,
    claude,
    "-p",
    "--model", manifest.agent.model,
    "--effort", manifest.agent.effort,
    "--max-budget-usd", String(manifest.agent.maxBudgetUsdPerRun),
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read", "Grep", "Glob", "Write", "Edit", "Bash(*)",
    "--tools", "Read", "Grep", "Glob", "Write", "Edit", "Bash",
    "--setting-sources", "project,local",
    "--settings", env.CODEMAP_EVAL_CLAUDE_SETTINGS!,
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--disable-slash-commands",
    "--no-session-persistence",
    "--no-chrome",
    "--system-prompt", "You are a coding agent in a controlled offline benchmark. Work only inside the current workspace and follow the user task exactly.",
    "--output-format", "stream-json",
    "--verbose",
  ];
  const child = spawnSync("timeout", values, {
    cwd: workspace.repo,
    env,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: manifest.agent.timeoutMs + 20_000,
  });
  return {
    status: child.status,
    stdout: redactAgentImpactToken(child.stdout ?? "", automationToken!),
    stderr: redactAgentImpactToken(child.stderr ?? "", automationToken!),
    timedOut: child.status === 124 || child.signal === "SIGTERM" || child.signal === "SIGKILL",
    ...(child.error ? { error: child.error.message } : {}),
  };
}

function treatmentInstruction(manifest: AgentImpactManifest): string {
  if (manifest.agent.navigationWorkflow === "context-first") {
    return `CodeMap ${manifest.codemapProfile.expectedVersion} is available. Start repository navigation with codemap context \"<task terms>\" before ordinary fallback tools; it returns a fused search-and-neighbor read plan.`;
  }
  return `CodeMap ${manifest.codemapProfile.expectedVersion} is available. Start repository navigation with codemap search, then use codemap context on a trusted hit before ordinary fallback tools.`;
}

function prepareWorkspace(task: AgentImpactTask, repoCache: string, parent: string, name: string, commit: string): PreparedWorkspace {
  const root = join(parent, name);
  const repo = join(root, "repo");
  const stateDir = join(root, "codemap-state");
  const callLog = join(root, "codemap-calls.log");
  mkdirSync(repo, { recursive: true });
  materializeSnapshot(repoCache, commit, repo);
  applySetupFiles(task, repo);
  execFileSync("git", ["init", "--quiet"], { cwd: repo, env: baseEnv() });
  execFileSync("git", ["add", "."], { cwd: repo, env: baseEnv() });
  execFileSync("git", ["-c", "user.name=CodeMap Eval", "-c", "user.email=codemap@example.invalid", "commit", "--quiet", "-m", "base snapshot"], { cwd: repo, env: baseEnv() });
  const setup = runSpec(task.setup, repo, baseEnv());
  if (setup.status !== 0) throw new Error(`${task.id} setup failed: ${tail(setup.stderr || setup.stdout)}`);
  const dirty = git(repo, ["status", "--porcelain"]);
  if (dirty.trim()) throw new Error(`${task.id} setup changed tracked workspace: ${dirty.trim()}`);
  mkdirSync(stateDir, { recursive: true });
  return { root, repo, stateDir, callLog };
}

function applySetupFiles(task: AgentImpactTask, workspace: string): void {
  for (const file of task.setupFiles) {
    const source = join(repoRoot, file.source);
    const bytes = readFileSync(source);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== file.sha256) throw new Error(`${task.id} setup file hash ${actual} != ${file.sha256}: ${file.source}`);
    const target = join(workspace, file.target);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

function materializeSnapshot(repoCache: string, commit: string, target: string): void {
  execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repoCache, env: baseEnv(), stdio: "ignore" });
  const archive = execFileSync("git", ["archive", "--format=tar", commit], { cwd: repoCache, env: baseEnv(), maxBuffer: 128 * 1024 * 1024 });
  const extracted = spawnSync("tar", ["-x", "-C", target], { input: archive, env: baseEnv(), maxBuffer: 4 * 1024 * 1024 });
  if (extracted.status !== 0) throw new Error(`tar extraction failed for ${commit}`);
}

function applyHiddenTests(task: AgentImpactTask, repoCache: string, workspace: string): void {
  for (const path of task.hiddenTestPaths) {
    const bytes = execFileSync("git", ["show", `${task.fixCommit}:${path}`], { cwd: repoCache, env: baseEnv(), maxBuffer: 32 * 1024 * 1024 });
    const target = join(workspace, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

function ensureRepositoryCache(id: string, remote: string, options: ParsedArgs): string {
  const target = join(options.cacheDir, "repositories", id);
  if (!existsSync(target)) {
    if (options.offline) throw new Error(`Missing offline repository cache: ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    const clone = spawnSync("git", ["clone", "--mirror", remote, target], { env: baseEnv(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (clone.status !== 0) throw new Error(`Failed to clone ${remote}: ${tail(clone.stderr)}`);
  } else if (!options.offline) {
    const fetch = spawnSync("git", ["fetch", "--prune", "origin"], { cwd: target, env: baseEnv(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (fetch.status !== 0) throw new Error(`Failed to refresh ${id}: ${tail(fetch.stderr)}`);
  }
  return target;
}

function ensureCodeMapProfile(manifest: AgentImpactManifest, options: ParsedArgs): string {
  const profile = manifest.codemapProfile;
  const target = join(options.cacheDir, "profiles", `codemap-${profile.expectedVersion}-${profile.gitCommit.slice(0, 12)}`);
  const binary = join(target, "dist", "cli", "bin.js");
  if (!existsSync(binary)) {
    mkdirSync(target, { recursive: true });
    materializeSnapshot(repoRoot, profile.gitCommit, target);
    const install = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: target,
      env: baseEnv(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 300_000,
    });
    if (install.status !== 0) throw new Error(`CodeMap profile install failed: ${tail(install.stderr)}`);
  }
  const version = execFileSync(process.execPath, [binary, "--version"], { env: baseEnv(), encoding: "utf8" }).trim();
  if (version !== profile.expectedVersion) throw new Error(`CodeMap profile version ${version} != ${profile.expectedVersion}`);
  return target;
}

function prepareCodeMap(workspace: PreparedWorkspace, profileDir: string, env: NodeJS.ProcessEnv): number {
  const binDir = join(workspace.root, "bin");
  mkdirSync(binDir, { recursive: true });
  const target = join(profileDir, "dist", "cli", "bin.js");
  const wrapper = join(binDir, "codemap");
  const script = `#!/bin/sh\ncase "$1" in search|context|index|status) printf '%s\\n' "$1" >> "$CODEMAP_CALL_LOG";; esac\nexec "${process.execPath}" "${target}" "$@"\n`;
  writeFileSync(wrapper, script, { mode: 0o700 });
  chmodSync(wrapper, 0o700);
  env.PATH = `${binDir}:${env.PATH}`;
  const startedAt = performance.now();
  const indexed = spawnSync(wrapper, ["index", "--approve"], { cwd: workspace.repo, env: withoutClaudeAuth(env), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (indexed.status !== 0) throw new Error(`CodeMap index failed: ${tail(indexed.stderr || indexed.stdout)}`);
  return Math.round(performance.now() - startedAt);
}

function agentEnv(workspace: PreparedWorkspace, mode: AgentImpactMode, profileDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...withoutClaudeAuth(process.env),
    ...isolatedAgentImpactClaude(workspace.root, claudeSettings(), automationToken!),
    PATH: sanitizedPath(),
    CODEMAP_HOME: workspace.stateDir,
    CODEMAP_TELEMETRY: "0",
    CODEMAP_CALL_LOG: workspace.callLog,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    CODEMAP_EVAL_WORKSPACE: workspace.repo,
  };
  if (mode === "baseline" && commandOnPath("codemap", env.PATH!)) throw new Error("baseline PATH still resolves codemap");
  if (mode === "codemap" && !existsSync(join(profileDir, "dist", "cli", "bin.js"))) throw new Error("treatment profile binary missing");
  return env;
}

function baseEnv(): NodeJS.ProcessEnv {
  return { ...withoutClaudeAuth(process.env), CI: "1", NO_COLOR: "1" };
}

function runSpec(spec: AgentImpactCommand, cwd: string, env: NodeJS.ProcessEnv): CommandResult {
  const child = spawnSync(spec.file, spec.args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: spec.timeoutMs,
  });
  return {
    status: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    timedOut: child.signal === "SIGTERM" || child.signal === "SIGKILL",
    ...(child.error ? { error: child.error.message } : {}),
  };
}

function captureDiff(repo: string, task: AgentImpactTask): Pick<AgentImpactRunResult, "changedPaths" | "forbiddenChanges" | "addedLines" | "deletedLines" | "expectedPathRecall"> {
  const changedPaths = git(repo, ["status", "--porcelain", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((row) => row.slice(3))
    .sort();
  const forbiddenChanges = changedPaths.filter((path) => task.forbiddenChangePaths.some((forbidden) => path === forbidden || path.startsWith(`${forbidden}/`)));
  let addedLines = 0;
  let deletedLines = 0;
  for (const row of git(repo, ["diff", "--numstat"]).trim().split("\n").filter(Boolean)) {
    const [added, deleted] = row.split("\t", 3);
    if (added !== "-") addedLines += Number(added);
    if (deleted !== "-") deletedLines += Number(deleted);
  }
  const changed = new Set(changedPaths);
  const expectedHits = task.expectedPaths.filter((path) => changed.has(path)).length;
  return {
    changedPaths,
    forbiddenChanges,
    addedLines,
    deletedLines,
    expectedPathRecall: round(expectedHits / task.expectedPaths.length, 4),
  };
}

function readCallLog(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  const counts: Record<string, number> = {};
  for (const command of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) counts[command] = (counts[command] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function failedRun(
  task: AgentImpactTask,
  mode: AgentImpactMode,
  runOrder: number,
  repo: string,
  usage: AgentUsage,
  child: CommandResult,
  agentDurationMs: number,
  indexDurationMs: number,
  infrastructureError: string,
): AgentImpactRunResult {
  return {
    taskId: task.id,
    repo: task.repo,
    mode,
    runOrder,
    agentExitCode: child.status,
    timedOut: child.timedOut,
    agentDurationMs,
    indexDurationMs,
    verifierExitCode: null,
    success: false,
    infrastructureError,
    ...captureDiff(repo, task),
    codemapCommands: {},
    usage,
  };
}

function emptyUsage(): AgentUsage {
  return {
    actualModel: "unknown",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    turns: 0,
    terminalReason: "unknown",
    isError: false,
    toolCalls: {},
  };
}

function scheduleRuns(tasks: AgentImpactTask[], modes: AgentImpactMode[], seed: number): Array<{ task: AgentImpactTask; mode: AgentImpactMode }> {
  return tasks.flatMap((task, index) => {
    const ordered = [...modes];
    if (ordered.length === 2 && (seed + index) % 2 === 1) ordered.reverse();
    return ordered.map((mode) => ({ task, mode }));
  });
}

function selectTasks(manifest: AgentImpactManifest, ids: string[]): AgentImpactTask[] {
  if (ids.length === 0) return manifest.tasks;
  const wanted = new Set(ids);
  const selected = manifest.tasks.filter((task) => wanted.has(task.id));
  const missing = ids.filter((id) => !selected.some((task) => task.id === id));
  if (missing.length > 0) throw new Error(`Unknown task id: ${missing.join(", ")}`);
  return selected;
}

function sanitizedPath(): string {
  const localBin = resolve(realHome, ".local", "bin");
  const parts = (process.env.PATH ?? "").split(":").filter((part) => part && resolve(part) !== localBin);
  return [...new Set(parts)].join(":");
}

function commandOnPath(command: string, path: string): boolean {
  const result = spawnSync("sh", ["-c", "command -v -- \"$1\" >/dev/null 2>&1", "sh", command], { env: { PATH: path } });
  return result.status === 0;
}

function resolveClaudeBin(): string {
  const configured = process.env.CODEMAP_EVAL_CLAUDE_BIN;
  if (configured) return resolve(configured);
  const candidate = join(realHome, ".local", "bin", "claude");
  if (!existsSync(candidate)) throw new Error(`Claude Code binary not found: ${candidate}`);
  return candidate;
}

function commandVersion(command: string): string {
  return execFileSync(command, ["--version"], { env: baseEnv(), encoding: "utf8" }).trim();
}

function claudeSettings(): Record<string, unknown> {
  const hook = { type: "command", command: `${process.execPath} ${claudeGuardPath}` };
  return {
    permissions: { defaultMode: "dontAsk" },
    hooks: {
      PreToolUse: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"].map((matcher) => ({ matcher, hooks: [hook] })),
    },
  };
}

function git(cwd: string, values: string[]): string {
  return execFileSync("git", values, { cwd, env: baseEnv(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function claimBoundary(purpose: AgentImpactManifest["corpus"]["purpose"]): string {
  if (purpose === "harness-smoke") return "Validates runner, isolation, oracle, adoption, and cost capture only; it is not product-effect evidence.";
  if (purpose === "development-pilot") return "Directional development evidence only; it cannot support a generalization claim.";
  return "Applies only to this frozen corpus, provider, model, effort, prompt, and execution environment.";
}

function parseArgs(raw: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    manifestPath: defaultManifestPath,
    cacheDir: join(homedir(), ".cache", "codemap", "agent-impact"),
    taskIds: [],
    mode: "all",
    validateOnly: false,
    dryRun: false,
    qualityGate: false,
    keepWorkdir: false,
    offline: false,
    resume: false,
    help: false,
  };
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index]!;
    const [name, inline] = arg.split("=", 2);
    const value = (): string => {
      const found = inline ?? raw[++index];
      if (!found) throw new Error(`${name} requires a value`);
      return found;
    };
    if (name === "--manifest") parsed.manifestPath = resolve(value());
    else if (name === "--cache-dir") parsed.cacheDir = resolve(value());
    else if (name === "--task") parsed.taskIds.push(value());
    else if (name === "--mode") {
      const mode = value();
      if (mode !== "baseline" && mode !== "codemap" && mode !== "all") throw new Error(`Unsupported mode: ${mode}`);
      parsed.mode = mode;
    } else if (name === "--approve-budget-usd") parsed.approveBudgetUsd = parsePositive(value(), name);
    else if (name === "--evidence-output") parsed.evidenceOutput = resolve(value());
    else if (name === "--trace-dir") parsed.traceDir = resolve(value());
    else if (arg === "--validate-oracles") parsed.validateOnly = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--quality-gate") parsed.qualityGate = true;
    else if (arg === "--keep-workdir") parsed.keepWorkdir = true;
    else if (arg === "--offline") parsed.offline = true;
    else if (arg === "--resume") parsed.resume = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

function parsePositive(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be positive`);
  return parsed;
}

function printHelp(): void {
  console.log(`Usage: npm run eval:agent-impact -- [options]\n\nOptions:\n  --dry-run                     Show tasks and worst-case paid budget\n  --validate-oracles            Prove base-fail/reference-fix-pass without agent calls\n  --approve-budget-usd <n>      Required cap approval; must cover worst case\n  --task <id>                   Select one task (repeatable)\n  --mode baseline|codemap|all   Select arm(s), default all\n  --offline                     Require existing repository cache\n  --quality-gate                Fail when harness/adoption gate fails\n  --evidence-output <path>      Checkpoint and write stable evidence for a full paired run\n  --resume                      Resume matching completed runs from evidence output\n  --trace-dir <path>            Retain raw provider output outside Git worktrees\n  --keep-workdir                Preserve temporary workspaces for diagnosis\n  --cache-dir <path>            Select maintainer cache\n  --manifest <path>             Select manifest`);
}

function tail(value: string, length = 1200): string {
  return value.length <= length ? value.trim() : value.slice(-length).trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
