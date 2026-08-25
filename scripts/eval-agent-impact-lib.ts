import { createHash } from "node:crypto";

export type AgentImpactMode = "baseline" | "codemap";

export interface AgentImpactCommand {
  file: string;
  args: string[];
  timeoutMs: number;
}

export interface AgentImpactTask {
  id: string;
  repo: string;
  sourceUrl: string;
  prompt: string;
  baseCommit: string;
  fixCommit: string;
  expectedPaths: string[];
  hiddenTestPaths: string[];
  expectedBaseFailure: string;
  forbiddenChangePaths: string[];
  setup: AgentImpactCommand;
  verify: AgentImpactCommand;
}

export interface AgentImpactManifest {
  schemaVersion: 1;
  corpus: {
    id: string;
    version: number;
    frozenAt: string;
    purpose: "harness-smoke" | "development-pilot" | "untouched-holdout";
    selectionProtocol: string;
    orderSeed: number;
  };
  agent: {
    provider: "claude-code";
    model: string;
    effort: "medium";
    navigationWorkflow: "search-then-context" | "context-first";
    maxBudgetUsdPerRun: number;
    timeoutMs: number;
  };
  codemapProfile: {
    gitCommit: string;
    expectedVersion: string;
  };
  repositories: Array<{ id: string; remote: string }>;
  tasks: AgentImpactTask[];
  pilotGate: {
    minValidPairs: number;
    minTreatmentAdoptionRate: number;
    maxCrossArmContamination: number;
    maxBudgetExhaustedRuns: number;
  };
}

export interface OracleValidationResult {
  taskId: string;
  baseHiddenTestExitCodes: Array<number | null>;
  referenceFixExitCodes: Array<number | null>;
  baseFailureKind: "assertion" | "other" | "timeout";
  baseFails: boolean;
  referencePasses: boolean;
  valid: boolean;
  error?: string;
}

export interface AgentUsage {
  actualModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  turns: number;
  terminalReason: string;
  isError: boolean;
  toolCalls: Record<string, number>;
}

export interface AgentImpactRunResult {
  taskId: string;
  repo: string;
  mode: AgentImpactMode;
  runOrder: number;
  agentExitCode: number | null;
  timedOut: boolean;
  agentDurationMs: number;
  indexDurationMs: number;
  verifierExitCode: number | null;
  success: boolean;
  infrastructureError?: string;
  changedPaths: string[];
  forbiddenChanges: string[];
  addedLines: number;
  deletedLines: number;
  expectedPathRecall: number;
  codemapCommands: Record<string, number>;
  usage: AgentUsage;
}

export interface AgentImpactSummary {
  tasks: number;
  validPairs: number;
  wins: number;
  losses: number;
  ties: number;
  exactTwoSidedP: number;
  baselineSuccessRate: number;
  treatmentSuccessRate: number;
  treatmentAdoptionRate: number;
  crossArmContamination: number;
  totalCostUsd: number;
  tokenRatio: number | null;
  agentDurationRatio: number | null;
  budgetExhaustedRuns: number;
  losingTasks: string[];
}

export interface AgentImpactGate {
  passed: boolean;
  issues: Array<{ metric: string; expected: string; actual: number | string }>;
}

export function parseAgentImpactManifest(raw: string): AgentImpactManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid agent-impact JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(value, "manifest");
  if (root.schemaVersion !== 1) throw new Error("manifest.schemaVersion must be 1");
  const corpus = record(root.corpus, "corpus");
  string(corpus.id, "corpus.id");
  positiveInteger(corpus.version, "corpus.version");
  const frozenAt = string(corpus.frozenAt, "corpus.frozenAt");
  if (!Number.isFinite(Date.parse(frozenAt))) throw new Error("corpus.frozenAt must be an ISO date");
  if (!new Set(["harness-smoke", "development-pilot", "untouched-holdout"]).has(String(corpus.purpose))) {
    throw new Error("corpus.purpose is unsupported");
  }
  string(corpus.selectionProtocol, "corpus.selectionProtocol");
  nonNegativeInteger(corpus.orderSeed, "corpus.orderSeed");

  const agent = record(root.agent, "agent");
  if (agent.provider !== "claude-code") throw new Error("agent.provider must be claude-code");
  string(agent.model, "agent.model");
  if (agent.effort !== "medium") throw new Error("agent.effort must be medium");
  const navigationWorkflow = agent.navigationWorkflow ?? "search-then-context";
  if (navigationWorkflow !== "search-then-context" && navigationWorkflow !== "context-first") {
    throw new Error("agent.navigationWorkflow is unsupported");
  }
  agent.navigationWorkflow = navigationWorkflow;
  positiveNumber(agent.maxBudgetUsdPerRun, "agent.maxBudgetUsdPerRun");
  positiveInteger(agent.timeoutMs, "agent.timeoutMs");

  const profile = record(root.codemapProfile, "codemapProfile");
  sha(profile.gitCommit, "codemapProfile.gitCommit");
  const expectedVersion = string(profile.expectedVersion, "codemapProfile.expectedVersion");
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error("codemapProfile.expectedVersion must be SemVer");

  if (!Array.isArray(root.repositories) || root.repositories.length === 0) throw new Error("repositories must be non-empty");
  const repositories = root.repositories.map((item, index) => {
    const entry = record(item, `repositories[${index}]`);
    const id = string(entry.id, `repositories[${index}].id`);
    const remote = string(entry.remote, `repositories[${index}].remote`);
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote)) {
      throw new Error(`repositories[${index}].remote must be a GitHub HTTPS URL`);
    }
    return { id, remote };
  });
  unique(repositories.map((item) => item.id), "repository id");
  const repoIds = new Set(repositories.map((item) => item.id));

  if (!Array.isArray(root.tasks) || root.tasks.length === 0) throw new Error("tasks must be non-empty");
  const tasks = root.tasks.map((item, index) => parseTask(item, index, repoIds));
  unique(tasks.map((item) => item.id), "task id");
  const remoteByRepo = new Map(repositories.map((item) => [item.id, item.remote.replace(/\.git$/, "")]));
  for (const task of tasks) {
    const prefix = `${remoteByRepo.get(task.repo)}/pull/`;
    if (!task.sourceUrl.startsWith(prefix) || !/^\d+$/.test(task.sourceUrl.slice(prefix.length))) {
      throw new Error(`${task.id}.sourceUrl must reference a pull request in ${task.repo}`);
    }
  }

  const gate = record(root.pilotGate, "pilotGate");
  const minValidPairs = positiveInteger(gate.minValidPairs, "pilotGate.minValidPairs");
  if (minValidPairs > tasks.length) throw new Error("pilotGate.minValidPairs cannot exceed task count");
  rate(gate.minTreatmentAdoptionRate, "pilotGate.minTreatmentAdoptionRate");
  nonNegativeInteger(gate.maxCrossArmContamination, "pilotGate.maxCrossArmContamination");
  nonNegativeInteger(gate.maxBudgetExhaustedRuns, "pilotGate.maxBudgetExhaustedRuns");
  return value as AgentImpactManifest;
}

export function parseClaudeJson(raw: string): AgentUsage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    try {
      value = raw.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    } catch {
      throw new Error(`Claude Code returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const rows = Array.isArray(value) ? value : [value];
  const result = rows.find((item) => isRecord(item) && item.type === "result");
  if (!isRecord(result)) throw new Error("Claude Code output has no result event");
  const usage = record(result.usage, "Claude result usage");
  const modelUsage = isRecord(result.modelUsage) ? result.modelUsage : {};
  const actualModel = Object.keys(modelUsage).find((name) => name.includes("opus")) ?? "unknown";
  const toolCalls: Record<string, number> = {};
  visit(value, (entry) => {
    if (entry.type !== "tool_use" || typeof entry.name !== "string") return;
    toolCalls[entry.name] = (toolCalls[entry.name] ?? 0) + 1;
  });
  return {
    actualModel,
    inputTokens: number(usage.input_tokens, "usage.input_tokens"),
    outputTokens: number(usage.output_tokens, "usage.output_tokens"),
    cacheReadInputTokens: optionalNumber(usage.cache_read_input_tokens),
    cacheCreationInputTokens: optionalNumber(usage.cache_creation_input_tokens),
    costUsd: number(result.total_cost_usd, "result.total_cost_usd"),
    turns: number(result.num_turns, "result.num_turns"),
    terminalReason: typeof result.terminal_reason === "string" ? result.terminal_reason : "unknown",
    isError: result.is_error === true || (typeof result.subtype === "string" && result.subtype !== "success"),
    toolCalls: sortRecord(toolCalls),
  };
}

export function summarizeAgentImpact(
  results: AgentImpactRunResult[],
  navigationWorkflow: AgentImpactManifest["agent"]["navigationWorkflow"] = "search-then-context",
): AgentImpactSummary {
  const byTask = new Map<string, Partial<Record<AgentImpactMode, AgentImpactRunResult>>>();
  for (const result of results) {
    const entry = byTask.get(result.taskId) ?? {};
    entry[result.mode] = result;
    byTask.set(result.taskId, entry);
  }
  let validPairs = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let baselinePasses = 0;
  let treatmentPasses = 0;
  let adopted = 0;
  const contamination = results
    .filter((item) => item.mode === "baseline")
    .reduce((total, item) => total + Object.values(item.codemapCommands).reduce((sum, count) => sum + count, 0), 0);
  const budgetExhaustedRuns = results.filter((item) => item.infrastructureError === "budget exhausted").length;
  const losingTasks: string[] = [];
  let baselineTokens = 0;
  let treatmentTokens = 0;
  let baselineDuration = 0;
  let treatmentDuration = 0;
  for (const [taskId, pair] of byTask) {
    const baseline = pair.baseline;
    const treatment = pair.codemap;
    if (!baseline || !treatment || baseline.infrastructureError || treatment.infrastructureError) continue;
    validPairs++;
    baselinePasses += Number(baseline.success);
    treatmentPasses += Number(treatment.success);
    baselineTokens += totalTokens(baseline.usage);
    treatmentTokens += totalTokens(treatment.usage);
    baselineDuration += baseline.agentDurationMs;
    treatmentDuration += treatment.agentDurationMs;
    const followedWorkflow = navigationWorkflow === "context-first"
      ? (treatment.codemapCommands.context ?? 0) > 0
      : (treatment.codemapCommands.search ?? 0) > 0 && (treatment.codemapCommands.context ?? 0) > 0;
    if (followedWorkflow) adopted++;
    if (treatment.success && !baseline.success) wins++;
    else if (!treatment.success && baseline.success) {
      losses++;
      losingTasks.push(taskId);
    } else ties++;
  }
  return {
    tasks: byTask.size,
    validPairs,
    wins,
    losses,
    ties,
    exactTwoSidedP: exactPairedP(wins, losses),
    baselineSuccessRate: roundRate(baselinePasses, validPairs),
    treatmentSuccessRate: roundRate(treatmentPasses, validPairs),
    treatmentAdoptionRate: roundRate(adopted, validPairs),
    crossArmContamination: contamination,
    totalCostUsd: round(results.reduce((sum, item) => sum + item.usage.costUsd, 0), 4),
    tokenRatio: baselineTokens > 0 ? round(treatmentTokens / baselineTokens, 4) : null,
    agentDurationRatio: baselineDuration > 0 ? round(treatmentDuration / baselineDuration, 4) : null,
    budgetExhaustedRuns,
    losingTasks: losingTasks.sort(),
  };
}

export function evaluateAgentImpactPilotGate(
  manifest: AgentImpactManifest,
  oracles: OracleValidationResult[],
  summary: AgentImpactSummary,
): AgentImpactGate {
  const issues: AgentImpactGate["issues"] = [];
  const invalidOracles = oracles.filter((item) => !item.valid).map((item) => item.taskId).sort();
  if (invalidOracles.length > 0) issues.push(issue("oracleValidation", "all base-fail/reference-pass", invalidOracles.join(",")));
  if (summary.validPairs < manifest.pilotGate.minValidPairs) {
    issues.push(issue("validPairs", `>= ${manifest.pilotGate.minValidPairs}`, summary.validPairs));
  }
  if (summary.treatmentAdoptionRate < manifest.pilotGate.minTreatmentAdoptionRate) {
    issues.push(issue("treatmentAdoptionRate", `>= ${manifest.pilotGate.minTreatmentAdoptionRate}`, summary.treatmentAdoptionRate));
  }
  if (summary.crossArmContamination > manifest.pilotGate.maxCrossArmContamination) {
    issues.push(issue("crossArmContamination", `<= ${manifest.pilotGate.maxCrossArmContamination}`, summary.crossArmContamination));
  }
  if (summary.budgetExhaustedRuns > manifest.pilotGate.maxBudgetExhaustedRuns) {
    issues.push(issue("budgetExhaustedRuns", `<= ${manifest.pilotGate.maxBudgetExhaustedRuns}`, summary.budgetExhaustedRuns));
  }
  return { passed: issues.length === 0, issues };
}

export function stableAgentImpactEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableAgentImpactEvidence);
  if (!isRecord(value)) return value;
  const omitted = new Set(["generatedAt", "durationMs", "workdir", "stdout", "stderr"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !omitted.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableAgentImpactEvidence(entry)]));
}

export function hashAgentImpactJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableAgentImpactEvidence(value))).digest("hex");
}

function parseTask(value: unknown, index: number, repoIds: Set<string>): AgentImpactTask {
  const task = record(value, `tasks[${index}]`);
  const id = string(task.id, `tasks[${index}].id`);
  const repo = string(task.repo, `tasks[${index}].repo`);
  if (!repoIds.has(repo)) throw new Error(`tasks[${index}].repo references unknown repository ${repo}`);
  const sourceUrl = string(task.sourceUrl, `tasks[${index}].sourceUrl`);
  const prompt = string(task.prompt, `tasks[${index}].prompt`);
  const baseCommit = sha(task.baseCommit, `tasks[${index}].baseCommit`);
  const fixCommit = sha(task.fixCommit, `tasks[${index}].fixCommit`);
  if (baseCommit === fixCommit) throw new Error(`tasks[${index}] baseCommit and fixCommit must differ`);
  const expectedPaths = paths(task.expectedPaths, `tasks[${index}].expectedPaths`);
  const hiddenTestPaths = paths(task.hiddenTestPaths, `tasks[${index}].hiddenTestPaths`);
  const expectedBaseFailure = string(task.expectedBaseFailure, `tasks[${index}].expectedBaseFailure`);
  const forbiddenChangePaths = paths(task.forbiddenChangePaths, `tasks[${index}].forbiddenChangePaths`, true);
  return {
    id,
    repo,
    sourceUrl,
    prompt,
    baseCommit,
    fixCommit,
    expectedPaths,
    hiddenTestPaths,
    expectedBaseFailure,
    forbiddenChangePaths,
    setup: command(task.setup, `tasks[${index}].setup`),
    verify: command(task.verify, `tasks[${index}].verify`),
  };
}

function command(value: unknown, label: string): AgentImpactCommand {
  const entry = record(value, label);
  const file = string(entry.file, `${label}.file`);
  if (file.includes("\0")) throw new Error(`${label}.file contains NUL`);
  if (!Array.isArray(entry.args) || entry.args.some((item) => typeof item !== "string" || item.includes("\0"))) {
    throw new Error(`${label}.args must be an array of strings without NUL`);
  }
  return { file, args: [...entry.args] as string[], timeoutMs: positiveInteger(entry.timeoutMs, `${label}.timeoutMs`) };
}

function paths(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  const result = value.map((item, index) => repoPath(item, `${label}[${index}]`));
  unique(result, label);
  return result;
}

function exactPairedP(wins: number, losses: number): number {
  const discordant = wins + losses;
  if (discordant === 0) return 1;
  const tail = Math.min(wins, losses);
  let cumulative = 0;
  for (let k = 0; k <= tail; k++) cumulative += choose(discordant, k);
  return round(Math.min(1, (2 * cumulative) / 2 ** discordant), 6);
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index++) result = (result * (n - k + index)) / index;
  return result;
}

function visit(value: unknown, fn: (entry: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
    return;
  }
  if (!isRecord(value)) return;
  fn(value);
  for (const item of Object.values(value)) visit(item, fn);
}

function totalTokens(usage: AgentUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function optionalNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positiveNumber(value: unknown, label: string): number {
  const result = number(value, label);
  if (result <= 0) throw new Error(`${label} must be positive`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  const result = number(value, label);
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = number(value, label);
  if (!Number.isInteger(result) || result < 0) throw new Error(`${label} must be a non-negative integer`);
  return result;
}

function rate(value: unknown, label: string): number {
  const result = number(value, label);
  if (result < 0 || result > 1) throw new Error(`${label} must be between 0 and 1`);
  return result;
}

function sha(value: unknown, label: string): string {
  const result = string(value, label);
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${label} must be a full 40-character Git SHA`);
  return result;
}

function repoPath(value: unknown, label: string): string {
  const result = string(value, label);
  if (result.startsWith("/") || result.split("/").includes("..")) throw new Error(`${label} must stay inside the repository`);
  return result;
}

function unique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortRecord(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function roundRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator, 4);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function issue(metric: string, expected: string, actual: number | string): AgentImpactGate["issues"][number] {
  return { metric, expected, actual };
}
