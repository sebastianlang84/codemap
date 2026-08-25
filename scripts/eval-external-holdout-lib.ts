import { createHash } from "node:crypto";

export type HoldoutMode = "lexical" | "search" | "context";
export const FROZEN_LEXICAL_PROFILE = "frozen-lexical";

export interface HoldoutProfile {
  id: string;
  gitCommit: string;
  expectedVersion: string;
}

export interface HoldoutRepository {
  id: string;
  remote: string;
}

export interface HoldoutCase {
  id: string;
  repo: string;
  sourceUrl: string;
  query: string;
  baseCommit: string;
  fixCommit: string;
  expectedPaths: string[];
}

export interface HoldoutGates {
  candidateProfile: string;
  baselineProfile: string;
  minCases: number;
  minRepos: number;
  minSuccessDeltaVsLexical: number;
  maxTokenRatioVsLexical: number;
  minSuccessDeltaVsBaseline: number;
}

export interface ExternalHoldoutManifest {
  schemaVersion: 1;
  corpus: {
    id: string;
    version: number;
    frozenAt: string;
    selectionProtocol: string;
  };
  budget: { files: number };
  profiles: HoldoutProfile[];
  repositories: HoldoutRepository[];
  cases: HoldoutCase[];
  gates: HoldoutGates;
}

export type OracleExclusionReason = "changelog" | "documentation" | "dependency_lock" | "central_registration" | "not_present_at_base";

export interface ExternalHoldoutOracleAudit {
  schemaVersion: 1;
  manifestSha256: string;
  exclusions: Array<{
    caseId: string;
    paths: Array<{ path: string; reason: OracleExclusionReason }>;
  }>;
}

export interface HoldoutCaseResult {
  caseId: string;
  repo: string;
  profile: string;
  mode: HoldoutMode;
  expectedPaths: string[];
  filesRead: string[];
  missingPaths: string[];
  success: boolean;
  recall: number;
  bytesRead: number;
  latencyMs: number;
}

export interface HoldoutModeMetrics {
  profile: string;
  mode: HoldoutMode;
  tasks: number;
  successRate: number;
  avgRecall: number;
  avgFilesRead: number;
  avgBytesRead: number;
  estTokensRead: number;
  avgLatencyMs: number;
}

export interface HoldoutGateIssue {
  metric: string;
  expected: string;
  actual: number | string;
}

export interface HoldoutGateResult {
  passed: boolean;
  issues: HoldoutGateIssue[];
  successDeltaVsLexical: number;
  tokenRatioVsLexical: number | null;
  successDeltaVsBaseline: number;
}

export interface PairedHoldoutImpact {
  pairs: number;
  successWins: number;
  successLosses: number;
  successTies: number;
  recallWins: number;
  recallLosses: number;
  recallTies: number;
  twoSidedExactP: number;
  successLosingCases: string[];
  recallLosingCases: string[];
}

export function parseExternalHoldoutManifest(raw: string): ExternalHoldoutManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid external holdout JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error("External holdout manifest must be an object");
  if (parsed.schemaVersion !== 1) throw new Error("External holdout manifest schemaVersion must be 1");
  const corpus = requireRecord(parsed.corpus, "corpus");
  requireString(corpus.id, "corpus.id");
  requirePositiveInteger(corpus.version, "corpus.version");
  const frozenAt = requireString(corpus.frozenAt, "corpus.frozenAt");
  if (!Number.isFinite(Date.parse(frozenAt))) throw new Error("corpus.frozenAt must be an ISO date");
  requireString(corpus.selectionProtocol, "corpus.selectionProtocol");
  const budget = requireRecord(parsed.budget, "budget");
  const fileBudget = requirePositiveInteger(budget.files, "budget.files");

  if (!Array.isArray(parsed.profiles) || parsed.profiles.length < 2) throw new Error("profiles must contain at least two entries");
  const profiles = parsed.profiles.map((value, index) => validateProfile(value, index));
  assertUnique(profiles.map((profile) => profile.id), "profile id");

  if (!Array.isArray(parsed.repositories) || parsed.repositories.length === 0) throw new Error("repositories must be non-empty");
  const repositories = parsed.repositories.map((value, index) => validateRepository(value, index));
  assertUnique(repositories.map((repo) => repo.id), "repository id");
  const repoIds = new Set(repositories.map((repo) => repo.id));

  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) throw new Error("cases must be non-empty");
  const cases = parsed.cases.map((value, index) => validateCase(value, index, repoIds, fileBudget));
  assertUnique(cases.map((item) => item.id), "case id");
  const remoteByRepo = new Map(repositories.map((repo) => [repo.id, repo.remote.replace(/\.git$/, "")]));
  for (const item of cases) {
    const expectedPrefix = `${remoteByRepo.get(item.repo)}/pull/`;
    if (!item.sourceUrl.startsWith(expectedPrefix) || !/^\d+$/.test(item.sourceUrl.slice(expectedPrefix.length))) {
      throw new Error(`${item.id}.sourceUrl must reference a pull request in repository ${item.repo}`);
    }
  }

  const gates = validateGates(parsed.gates);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  if (!profileIds.has(gates.candidateProfile)) throw new Error(`gates.candidateProfile references unknown profile ${gates.candidateProfile}`);
  if (!profileIds.has(gates.baselineProfile)) throw new Error(`gates.baselineProfile references unknown profile ${gates.baselineProfile}`);
  if (gates.candidateProfile === gates.baselineProfile) throw new Error("candidate and baseline profiles must differ");

  return parsed as unknown as ExternalHoldoutManifest;
}

export function parseExternalHoldoutOracleAudit(raw: string, manifest: ExternalHoldoutManifest, manifestSha256: string): ExternalHoldoutOracleAudit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid external holdout oracle audit JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = requireRecord(parsed, "oracle audit");
  if (root.schemaVersion !== 1) throw new Error("oracle audit schemaVersion must be 1");
  if (root.manifestSha256 !== manifestSha256) throw new Error(`oracle audit manifestSha256 must equal ${manifestSha256}`);
  if (!Array.isArray(root.exclusions)) throw new Error("oracle audit exclusions must be an array");
  const caseIds = new Set(manifest.cases.map((item) => item.id));
  const reasons = new Set<OracleExclusionReason>(["changelog", "documentation", "dependency_lock", "central_registration", "not_present_at_base"]);
  const exclusions = root.exclusions.map((value, index) => {
    const entry = requireRecord(value, `exclusions[${index}]`);
    const caseId = requireString(entry.caseId, `exclusions[${index}].caseId`);
    if (!caseIds.has(caseId)) throw new Error(`exclusions[${index}].caseId references unknown case ${caseId}`);
    if (!Array.isArray(entry.paths) || entry.paths.length === 0) throw new Error(`exclusions[${index}].paths must be non-empty`);
    const paths = entry.paths.map((pathValue, pathIndex) => {
      const row = requireRecord(pathValue, `exclusions[${index}].paths[${pathIndex}]`);
      const path = requireRepoPath(row.path, `exclusions[${index}].paths[${pathIndex}].path`);
      const reason = requireString(row.reason, `exclusions[${index}].paths[${pathIndex}].reason`) as OracleExclusionReason;
      if (!reasons.has(reason)) throw new Error(`Unsupported oracle exclusion reason: ${reason}`);
      return { path, reason };
    });
    assertUnique(paths.map((item) => item.path), `oracle exclusion path for ${caseId}`);
    return { caseId, paths };
  });
  assertUnique(exclusions.map((item) => item.caseId), "oracle exclusion case id");
  return { schemaVersion: 1, manifestSha256, exclusions };
}

export function scoreHoldoutSelection(options: {
  caseId: string;
  repo: string;
  profile: string;
  mode: HoldoutMode;
  expectedPaths: string[];
  filesRead: string[];
  bytesRead: number;
  latencyMs: number;
}): HoldoutCaseResult {
  const filesRead = unique(options.filesRead);
  const found = new Set(filesRead);
  const missingPaths = options.expectedPaths.filter((path) => !found.has(path));
  return {
    ...options,
    expectedPaths: [...options.expectedPaths],
    filesRead,
    missingPaths,
    success: missingPaths.length === 0,
    recall: round((options.expectedPaths.length - missingPaths.length) / options.expectedPaths.length),
  };
}

export function summarizeHoldoutMode(profile: string, mode: HoldoutMode, cases: HoldoutCaseResult[], repo?: string): HoldoutModeMetrics {
  const selected = cases.filter((item) => item.profile === profile && item.mode === mode && (repo === undefined || item.repo === repo));
  const avgBytes = average(selected.map((item) => item.bytesRead));
  return {
    profile,
    mode,
    tasks: selected.length,
    successRate: round(rate(selected.filter((item) => item.success).length, selected.length)),
    avgRecall: round(average(selected.map((item) => item.recall))),
    avgFilesRead: round(average(selected.map((item) => item.filesRead.length))),
    avgBytesRead: Math.round(avgBytes),
    estTokensRead: Math.round(avgBytes / 4),
    avgLatencyMs: round(average(selected.map((item) => item.latencyMs)), 3),
  };
}

export function evaluateExternalHoldoutGate(
  manifest: ExternalHoldoutManifest,
  metrics: HoldoutModeMetrics[],
  observed: { cases: number; repos: number },
): HoldoutGateResult {
  const issues: HoldoutGateIssue[] = [];
  const gates = manifest.gates;
  const candidate = requireMetric(metrics, gates.candidateProfile, "context");
  const baseline = requireMetric(metrics, gates.baselineProfile, "context");
  const lexical = requireMetric(metrics, FROZEN_LEXICAL_PROFILE, "lexical");
  const successDeltaVsLexical = round(candidate.successRate - lexical.successRate);
  const successDeltaVsBaseline = round(candidate.successRate - baseline.successRate);
  const tokenRatioVsLexical = lexical.estTokensRead > 0 ? round(candidate.estTokensRead / lexical.estTokensRead) : null;
  if (observed.cases < gates.minCases) issues.push(issue("cases", `>= ${gates.minCases}`, observed.cases));
  if (observed.repos < gates.minRepos) issues.push(issue("repos", `>= ${gates.minRepos}`, observed.repos));
  if (successDeltaVsLexical < gates.minSuccessDeltaVsLexical) issues.push(issue("successDeltaVsLexical", `>= ${gates.minSuccessDeltaVsLexical}`, successDeltaVsLexical));
  if (tokenRatioVsLexical === null || tokenRatioVsLexical > gates.maxTokenRatioVsLexical) issues.push(issue("tokenRatioVsLexical", `<= ${gates.maxTokenRatioVsLexical}`, tokenRatioVsLexical ?? "unavailable"));
  if (successDeltaVsBaseline < gates.minSuccessDeltaVsBaseline) issues.push(issue("successDeltaVsBaseline", `>= ${gates.minSuccessDeltaVsBaseline}`, successDeltaVsBaseline));
  return { passed: issues.length === 0, issues, successDeltaVsLexical, tokenRatioVsLexical, successDeltaVsBaseline };
}

export function parseCliJson(stdout: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label} returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} returned non-object JSON`);
  return parsed;
}

export function compareHoldoutSelections(
  cases: HoldoutCaseResult[],
  left: { profile: string; mode: HoldoutMode },
  right: { profile: string; mode: HoldoutMode },
): PairedHoldoutImpact {
  const rightByCase = new Map(cases.filter((item) => item.profile === right.profile && item.mode === right.mode).map((item) => [item.caseId, item]));
  const impact: PairedHoldoutImpact = {
    pairs: 0,
    successWins: 0,
    successLosses: 0,
    successTies: 0,
    recallWins: 0,
    recallLosses: 0,
    recallTies: 0,
    twoSidedExactP: 1,
    successLosingCases: [],
    recallLosingCases: [],
  };
  for (const item of cases.filter((candidate) => candidate.profile === left.profile && candidate.mode === left.mode)) {
    const baseline = rightByCase.get(item.caseId);
    if (!baseline) continue;
    impact.pairs++;
    const successDelta = Number(item.success) - Number(baseline.success);
    if (successDelta > 0) impact.successWins++;
    else if (successDelta < 0) {
      impact.successLosses++;
      impact.successLosingCases.push(item.caseId);
    } else impact.successTies++;
    const recallDelta = item.recall - baseline.recall;
    if (recallDelta > 1e-6) impact.recallWins++;
    else if (recallDelta < -1e-6) {
      impact.recallLosses++;
      impact.recallLosingCases.push(item.caseId);
    } else impact.recallTies++;
  }
  impact.successLosingCases.sort();
  impact.recallLosingCases.sort();
  impact.twoSidedExactP = exactPairedP(impact.successWins, impact.successLosses);
  return impact;
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateProfile(value: unknown, index: number): HoldoutProfile {
  const profile = requireRecord(value, `profiles[${index}]`);
  const id = requireString(profile.id, `profiles[${index}].id`);
  const gitCommit = requireSha(profile.gitCommit, `profiles[${index}].gitCommit`);
  const expectedVersion = requireString(profile.expectedVersion, `profiles[${index}].expectedVersion`);
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error(`profiles[${index}].expectedVersion must be SemVer`);
  return { id, gitCommit, expectedVersion };
}

function validateRepository(value: unknown, index: number): HoldoutRepository {
  const repo = requireRecord(value, `repositories[${index}]`);
  const id = requireString(repo.id, `repositories[${index}].id`);
  const remote = requireString(repo.remote, `repositories[${index}].remote`);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote)) throw new Error(`repositories[${index}].remote must be a GitHub HTTPS URL`);
  return { id, remote };
}

function validateCase(value: unknown, index: number, repoIds: Set<string>, budget: number): HoldoutCase {
  const item = requireRecord(value, `cases[${index}]`);
  const id = requireString(item.id, `cases[${index}].id`);
  const repo = requireString(item.repo, `cases[${index}].repo`);
  if (!repoIds.has(repo)) throw new Error(`cases[${index}].repo references unknown repository ${repo}`);
  const sourceUrl = requireString(item.sourceUrl, `cases[${index}].sourceUrl`);
  if (!/^https:\/\/github\.com\//.test(sourceUrl)) throw new Error(`cases[${index}].sourceUrl must be a GitHub URL`);
  const query = requireString(item.query, `cases[${index}].query`);
  const baseCommit = requireSha(item.baseCommit, `cases[${index}].baseCommit`);
  const fixCommit = requireSha(item.fixCommit, `cases[${index}].fixCommit`);
  if (baseCommit === fixCommit) throw new Error(`cases[${index}] baseCommit and fixCommit must differ`);
  if (!Array.isArray(item.expectedPaths) || item.expectedPaths.length === 0) throw new Error(`cases[${index}].expectedPaths must be non-empty`);
  const expectedPaths = item.expectedPaths.map((path, pathIndex) => requireRepoPath(path, `cases[${index}].expectedPaths[${pathIndex}]`));
  assertUnique(expectedPaths, `cases[${index}] expected path`);
  if (expectedPaths.length > budget) throw new Error(`cases[${index}] has ${expectedPaths.length} expected paths above ${budget}-file budget`);
  return { id, repo, sourceUrl, query, baseCommit, fixCommit, expectedPaths };
}

/** Exact two-sided sign/McNemar test over discordant success pairs. */
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
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

function validateGates(value: unknown): HoldoutGates {
  const gates = requireRecord(value, "gates");
  return {
    candidateProfile: requireString(gates.candidateProfile, "gates.candidateProfile"),
    baselineProfile: requireString(gates.baselineProfile, "gates.baselineProfile"),
    minCases: requirePositiveInteger(gates.minCases, "gates.minCases"),
    minRepos: requirePositiveInteger(gates.minRepos, "gates.minRepos"),
    minSuccessDeltaVsLexical: requireRate(gates.minSuccessDeltaVsLexical, "gates.minSuccessDeltaVsLexical"),
    maxTokenRatioVsLexical: requireRate(gates.maxTokenRatioVsLexical, "gates.maxTokenRatioVsLexical"),
    minSuccessDeltaVsBaseline: requireNumber(gates.minSuccessDeltaVsBaseline, "gates.minSuccessDeltaVsBaseline"),
  };
}

function requireMetric(metrics: HoldoutModeMetrics[], profile: string, mode: HoldoutMode): HoldoutModeMetrics {
  const found = metrics.find((metric) => metric.profile === profile && metric.mode === mode);
  if (!found) throw new Error(`Missing metrics for ${profile}/${mode}`);
  return found;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireSha(value: unknown, label: string): string {
  const sha = requireString(value, label);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error(`${label} must be a full 40-character Git SHA`);
  return sha;
}

function requireRepoPath(value: unknown, label: string): string {
  const path = requireString(value, label);
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`${label} must stay inside the repository`);
  return path;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function requireRate(value: unknown, label: string): number {
  const rateValue = requireNumber(value, label);
  if (rateValue < 0 || rateValue > 1) throw new Error(`${label} must be between 0 and 1`);
  return rateValue;
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function issue(metric: string, expected: string, actual: number | string): HoldoutGateIssue {
  return { metric, expected, actual };
}
