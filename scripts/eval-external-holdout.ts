#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  compareHoldoutSelections,
  evaluateExternalHoldoutGate,
  FROZEN_LEXICAL_PROFILE,
  hashJson,
  parseCliJson,
  parseExternalHoldoutManifest,
  parseExternalHoldoutOracleAudit,
  scoreHoldoutSelection,
  summarizeHoldoutMode,
  type ExternalHoldoutManifest,
  type ExternalHoldoutOracleAudit,
  type HoldoutCase,
  type HoldoutCaseResult,
  type HoldoutMode,
  type HoldoutProfile,
  type HoldoutRepository,
} from "./eval-external-holdout-lib.ts";

interface ParsedArgs {
  manifestPath: string;
  oraclePath: string;
  cacheDir: string;
  qualityGate: boolean;
  offline: boolean;
  keepWorkdir: boolean;
  summary: boolean;
  allowCustomCorpus: boolean;
  caseId?: string;
  evidenceOutput?: string;
}

interface PreparedProfile extends HoldoutProfile {
  bin: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const defaultManifestPath = join(scriptDir, "eval-external-holdout.manifest.json");
const defaultOraclePath = join(scriptDir, "eval-external-holdout.oracle.json");
const FROZEN_MANIFEST_SHA256 = "94a8cb51d6bdb822855e1de6b821c33d893c7bf47069f057f43f6133c2f599af";
const FROZEN_ORACLE_SHA256 = "0f53d7d6cdaefca5836755fa4aecf99a8b69e3f75c6b0ae50f511d3e7145a163";
const parsed = parseArgs(process.argv.slice(2));
const manifestRaw = readFileSync(parsed.manifestPath, "utf8");
const manifest = parseExternalHoldoutManifest(manifestRaw);
const manifestSha256 = hashJson(JSON.parse(manifestRaw));
const oracleRaw = readFileSync(parsed.oraclePath, "utf8");
const oracleAuditSha256 = hashJson(JSON.parse(oracleRaw));
if (!parsed.allowCustomCorpus && (manifestSha256 !== FROZEN_MANIFEST_SHA256 || oracleAuditSha256 !== FROZEN_ORACLE_SHA256)) {
  throw new Error("External holdout corpus differs from frozen v1; pass --allow-custom-corpus for an explicit non-v1 run");
}
const oracleAudit = parseExternalHoldoutOracleAudit(oracleRaw, manifest, manifestSha256);
const selectedCases = parsed.caseId ? manifest.cases.filter((item) => item.id === parsed.caseId) : manifest.cases;
if (selectedCases.length === 0) throw new Error(`Unknown holdout case: ${parsed.caseId}`);
if (parsed.caseId && parsed.evidenceOutput) throw new Error("--evidence-output requires the complete corpus; remove --case");

mkdirSync(parsed.cacheDir, { recursive: true });
const runRoot = mkdtempSync(join(parsed.cacheDir, "run-"));
try {
  const report = runHoldout(manifest, oracleAudit, selectedCases, parsed, runRoot, manifestSha256, oracleAuditSha256);
  if (parsed.evidenceOutput) writeFileSync(parsed.evidenceOutput, `${JSON.stringify(evidenceProjection(report), null, 2)}\n`, { mode: 0o644 });
  const output = parsed.summary ? { ...report, cases: undefined } : report;
  console.log(JSON.stringify(output, null, 2));
  if (parsed.qualityGate && !report.gate.passed) process.exitCode = 1;
} finally {
  if (!parsed.keepWorkdir) rmSync(runRoot, { recursive: true, force: true });
}

function runHoldout(
  manifest: ExternalHoldoutManifest,
  oracleAudit: ExternalHoldoutOracleAudit,
  cases: HoldoutCase[],
  options: ParsedArgs,
  workRoot: string,
  manifestSha256: string,
  oracleAuditSha256: string,
) {
  const profiles = manifest.profiles.map((profile) => prepareProfile(profile, options));
  const repoById = new Map(manifest.repositories.map((repo) => [repo.id, repo]));
  const casesByRepo = new Map<string, HoldoutCase[]>();
  for (const item of cases) (casesByRepo.get(item.repo) ?? casesByRepo.set(item.repo, []).get(item.repo)!).push(item);
  const repoCaches = new Map<string, string>();
  const exclusionsByCase = new Map(oracleAudit.exclusions.map((item) => [item.caseId, item.paths]));
  for (const [repoId, repoCases] of casesByRepo) {
    const repo = repoById.get(repoId)!;
    repoCaches.set(repoId, prepareRepository(repo, repoCases, options));
  }

  const results: HoldoutCaseResult[] = [];
  let completed = 0;
  for (const item of cases) {
    completed++;
    console.error(`[external-holdout] ${completed}/${cases.length} ${item.id}`);
    const cache = repoCaches.get(item.repo)!;
    const snapshot = join(workRoot, "snapshots", item.id);
    mkdirSync(dirname(snapshot), { recursive: true });
    addSnapshot(cache, item.baseCommit, snapshot);
    try {
      validateOracle(cache, snapshot, item, exclusionsByCase.get(item.id) ?? []);
      const lexicalStart = performance.now();
      const lexicalFiles = lexicalSearch(snapshot, item.query, manifest.budget.files);
      results.push(scoreResult(item, FROZEN_LEXICAL_PROFILE, "lexical", lexicalFiles, snapshot, performance.now() - lexicalStart));
      for (const profile of profiles) {
        const stateDir = join(workRoot, "state", profile.id, item.id);
        mkdirSync(stateDir, { recursive: true });
        runCodemap(profile, snapshot, stateDir, ["index", "--approve", "--json"]);
        const searchStart = performance.now();
        const search = runCodemap(profile, snapshot, stateDir, ["search", item.query, "--limit", String(manifest.budget.files), "--json"]);
        const searchFiles = resultPaths(search, "results", `${profile.id} search ${item.id}`);
        results.push(scoreResult(item, profile.id, "search", searchFiles, snapshot, performance.now() - searchStart));
        const contextStart = performance.now();
        const context = runCodemap(profile, snapshot, stateDir, ["context", item.query, "--limit", String(manifest.budget.files), "--json"]);
        const contextFiles = resultPaths(context, "readFirst", `${profile.id} context ${item.id}`);
        results.push(scoreResult(item, profile.id, "context", contextFiles, snapshot, performance.now() - contextStart));
      }
    } finally {
      removeSnapshot(cache, snapshot);
    }
  }

  const metrics = [
    summarizeHoldoutMode(FROZEN_LEXICAL_PROFILE, "lexical", results),
    ...profiles.flatMap((profile) => ([
      summarizeHoldoutMode(profile.id, "search", results),
      summarizeHoldoutMode(profile.id, "context", results),
    ])),
  ];
  const repositories = [...casesByRepo.keys()].sort();
  const perRepoMetrics = repositories.flatMap((repo) => [
    { repo, ...summarizeHoldoutMode(FROZEN_LEXICAL_PROFILE, "lexical", results, repo) },
    ...profiles.flatMap((profile) => ([
      { repo, ...summarizeHoldoutMode(profile.id, "search", results, repo) },
      { repo, ...summarizeHoldoutMode(profile.id, "context", results, repo) },
    ])),
  ]);
  const gate = evaluateExternalHoldoutGate(manifest, metrics, { cases: cases.length, repos: new Set(cases.map((item) => item.repo)).size });
  const candidate = manifest.gates.candidateProfile;
  const baseline = manifest.gates.baselineProfile;
  const comparisons = {
    candidateContextVsLexical: compareHoldoutSelections(results, { profile: candidate, mode: "context" }, { profile: FROZEN_LEXICAL_PROFILE, mode: "lexical" }),
    candidateContextVsBaseline: compareHoldoutSelections(results, { profile: candidate, mode: "context" }, { profile: baseline, mode: "context" }),
    candidateContextVsSearch: compareHoldoutSelections(results, { profile: candidate, mode: "context" }, { profile: candidate, mode: "search" }),
  };
  const qualitative = results
    .map(({ caseId, repo, profile, mode, expectedPaths, filesRead, missingPaths, success, recall }) => ({ caseId, repo, profile, mode, expectedPaths, filesRead, missingPaths, success, recall }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId) || left.profile.localeCompare(right.profile) || left.mode.localeCompare(right.mode));
  return {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    corpus: manifest.corpus,
    manifestSha256,
    oracleAuditSha256,
    frozenCorpusEnforced: !options.allowCustomCorpus,
    qualitativeResultSha256: hashJson(qualitative),
    readBudget: manifest.budget.files,
    profiles: profiles.map(({ bin: _bin, ...profile }) => profile),
    repositories,
    cases: results,
    metrics,
    perRepoMetrics,
    comparisons,
    gate,
    workdir: options.keepWorkdir ? workRoot : undefined,
  };
}

function evidenceProjection(report: ReturnType<typeof runHoldout>) {
  const withoutLatency = <T extends { avgLatencyMs: number }>({ avgLatencyMs: _latency, ...metric }: T) => metric;
  return {
    schemaVersion: 1,
    corpus: report.corpus,
    manifestSha256: report.manifestSha256,
    oracleAuditSha256: report.oracleAuditSha256,
    frozenCorpusEnforced: report.frozenCorpusEnforced,
    qualitativeResultSha256: report.qualitativeResultSha256,
    readBudget: report.readBudget,
    profiles: report.profiles,
    repositories: report.repositories,
    metrics: report.metrics.map(withoutLatency),
    perRepoMetrics: report.perRepoMetrics.map(withoutLatency),
    comparisons: report.comparisons,
    gate: report.gate,
    cases: report.cases.map(({ latencyMs: _latency, ...item }) => item),
  };
}

function prepareProfile(profile: HoldoutProfile, options: ParsedArgs): PreparedProfile {
  const target = join(options.cacheDir, "profiles", `${profile.id}-${profile.gitCommit.slice(0, 12)}`);
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    runStrict("git", ["clone", "--local", "--no-hardlinks", "--no-checkout", projectRoot, target], projectRoot, "clone CodeMap profile");
    runStrict("git", ["checkout", "--detach", profile.gitCommit], target, `checkout ${profile.id}`);
  }
  const actualCommit = runStrict("git", ["rev-parse", "HEAD"], target, `verify ${profile.id}`).trim();
  if (actualCommit !== profile.gitCommit) throw new Error(`${profile.id} cache is at ${actualCommit}, expected ${profile.gitCommit}`);
  const bin = join(target, "dist", "cli", "bin.js");
  if (!existsSync(bin)) throw new Error(`${profile.id} has no tracked dist/cli/bin.js`);
  const profilePackage = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  if (Object.keys(profilePackage.dependencies ?? {}).length > 0 && !existsSync(join(target, "node_modules"))) {
    runStrict("npm", ["ci", "--omit=dev", "--ignore-scripts"], target, `install ${profile.id} production dependencies`, {
      ...process.env,
      ...(options.offline ? { npm_config_offline: "true" } : {}),
    });
  }
  const version = runStrict(process.execPath, [bin, "--version"], target, `${profile.id} --version`).trim();
  if (version !== profile.expectedVersion) throw new Error(`${profile.id} reports ${version}, expected ${profile.expectedVersion}`);
  return { ...profile, bin };
}

function prepareRepository(repo: HoldoutRepository, cases: HoldoutCase[], options: ParsedArgs): string {
  const target = join(options.cacheDir, "repositories", repo.id);
  if (!existsSync(target)) {
    if (options.offline) throw new Error(`Offline cache missing for ${repo.id}: ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    runStrict("git", ["clone", "--filter=blob:none", "--no-checkout", repo.remote, target], projectRoot, `clone ${repo.id}`);
  } else {
    const actualRemote = runStrict("git", ["remote", "get-url", "origin"], target, `verify remote ${repo.id}`).trim();
    if (normalizeRemote(actualRemote) !== normalizeRemote(repo.remote)) throw new Error(`${repo.id} cache remote mismatch: ${actualRemote}`);
    if (!options.offline) runStrict("git", ["fetch", "--filter=blob:none", "origin", "--prune"], target, `fetch ${repo.id}`);
  }
  for (const sha of new Set(cases.flatMap((item) => [item.baseCommit, item.fixCommit]))) {
    runStrict("git", ["cat-file", "-e", `${sha}^{commit}`], target, `${repo.id} missing commit ${sha}`);
  }
  return target;
}

function addSnapshot(cache: string, commit: string, snapshot: string): void {
  runStrict("git", ["worktree", "add", "--detach", snapshot, commit], cache, `checkout snapshot ${commit}`);
}

function removeSnapshot(cache: string, snapshot: string): void {
  const result = spawnSync("git", ["worktree", "remove", "--force", snapshot], { cwd: cache, encoding: "utf8" });
  if (result.status !== 0 && existsSync(snapshot)) rmSync(snapshot, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: cache, encoding: "utf8" });
}

function validateOracle(
  cache: string,
  snapshot: string,
  item: HoldoutCase,
  exclusions: Array<{ path: string; reason: string }>,
): void {
  const changed = new Set(runStrict("git", ["diff", "--no-renames", "--name-only", item.baseCommit, item.fixCommit, "--"], cache, `diff oracle ${item.id}`).split(/\r?\n/).filter(Boolean));
  const excluded = new Map(exclusions.map((entry) => [entry.path, entry.reason]));
  for (const path of item.expectedPaths) {
    if (!changed.has(path)) throw new Error(`${item.id}: expected path is not in fix diff: ${path}`);
    if (excluded.has(path)) throw new Error(`${item.id}: path is both expected and excluded: ${path}`);
    const fullPath = safePath(snapshot, path);
    if (!existsSync(fullPath) || !lstatSync(fullPath).isFile()) throw new Error(`${item.id}: expected path did not exist at base commit: ${path}`);
  }
  for (const [path, reason] of excluded) {
    if (!changed.has(path)) throw new Error(`${item.id}: excluded path is not in fix diff: ${path}`);
    const existsAtBase = existsSync(safePath(snapshot, path));
    if (reason === "not_present_at_base" && existsAtBase) throw new Error(`${item.id}: excluded path marked not_present_at_base but exists: ${path}`);
    if (reason !== "not_present_at_base" && !existsAtBase) throw new Error(`${item.id}: excluded ${reason} path did not exist at base: ${path}`);
  }
  for (const path of changed) {
    if (!item.expectedPaths.includes(path) && !excluded.has(path)) throw new Error(`${item.id}: fix-diff path lacks oracle disposition: ${path}`);
  }
}

function runCodemap(profile: PreparedProfile, repo: string, stateDir: string, args: string[]): Record<string, unknown> {
  const stdout = runStrict(process.execPath, [profile.bin, ...args, "--repo", repo, "--state-dir", stateDir], repo, `${profile.id} ${args[0]}`, {
    ...process.env,
    CODEMAP_TELEMETRY: "0",
  });
  return parseCliJson(stdout, `${profile.id} ${args[0]}`);
}

function resultPaths(pkg: Record<string, unknown>, field: "results" | "readFirst", label: string): string[] {
  const rows = pkg[field];
  if (!Array.isArray(rows)) throw new Error(`${label} JSON lacks ${field}[]`);
  return unique(rows.map((row, index) => {
    if (typeof row !== "object" || row === null || typeof (row as { path?: unknown }).path !== "string") throw new Error(`${label} ${field}[${index}] lacks path`);
    return (row as { path: string }).path;
  }));
}

function scoreResult(item: HoldoutCase, profile: string, mode: HoldoutMode, filesRead: string[], root: string, latencyMs: number): HoldoutCaseResult {
  return scoreHoldoutSelection({
    caseId: item.id,
    repo: item.repo,
    profile,
    mode,
    expectedPaths: item.expectedPaths,
    filesRead,
    bytesRead: sumBytes(root, filesRead),
    latencyMs: round(latencyMs, 3),
  });
}

// Frozen rg-like baseline. Keep it local to this harness so future CodeMap ranking changes cannot
// change the comparator. CamelCase/path normalization and path weighting match the prior real-repo eval.
function lexicalSearch(root: string, query: string, limit: number): string[] {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const terms = unique(normalizeText(query).split(/[^a-z0-9_]+/).filter((term) => term.length > 1));
  return paths.map((path) => {
    const fullPath = safePath(root, path);
    if (!safeTextFile(fullPath)) return { path, score: 0 };
    const text = readFileSync(fullPath, "utf8");
    const normalizedPath = normalizeText(path);
    const normalizedText = normalizeText(text);
    let score = 0;
    for (const term of terms) score += countOccurrences(normalizedPath, term) * 4 + countOccurrences(normalizedText, term);
    return { path, score };
  }).filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map((hit) => hit.path);
}

function safeTextFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) return false;
    const lower = basename(path).toLowerCase();
    if (/\.(png|jpe?g|gif|ico|pdf|xlsx?|zip|gz|wasm)$/.test(lower)) return false;
    const sample = readFileSync(path).subarray(0, 8192);
    return !sample.includes(0);
  } catch {
    return false;
  }
}

function sumBytes(root: string, paths: string[]): number {
  let total = 0;
  for (const path of unique(paths)) {
    try {
      const stat = lstatSync(safePath(root, path));
      if (stat.isFile()) total += stat.size;
    } catch {
      // A stale or invalid returned path counts as zero bytes but remains visible in the case report.
    }
  }
  return total;
}

function safePath(root: string, relative: string): string {
  const full = resolve(root, relative);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (full !== root && !full.startsWith(prefix)) throw new Error(`Path escapes repository: ${relative}`);
  return full;
}

function runStrict(command: string, args: string[], cwd: string, label: string, env = process.env): string {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    manifestPath: defaultManifestPath,
    oraclePath: defaultOraclePath,
    cacheDir: join(homedir(), ".cache", "codemap", "external-holdout"),
    qualityGate: false,
    offline: false,
    keepWorkdir: false,
    summary: false,
    allowCustomCorpus: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq !== -1 ? arg.slice(0, eq) : arg;
    const inlineValue = arg.startsWith("--") && eq !== -1 ? arg.slice(eq + 1) : undefined;
    const value = () => {
      const result = inlineValue ?? args[++i];
      if (result === undefined || result.trim() === "") throw new Error(`${name} requires a value`);
      return result;
    };
    if (name === "--manifest") parsed.manifestPath = resolve(value());
    else if (name === "--oracle") parsed.oraclePath = resolve(value());
    else if (name === "--cache-dir") parsed.cacheDir = resolve(value());
    else if (name === "--case") parsed.caseId = value();
    else if (name === "--evidence-output") parsed.evidenceOutput = resolve(value());
    else if (name === "--quality-gate") parsed.qualityGate = true;
    else if (name === "--offline") parsed.offline = true;
    else if (name === "--keep-workdir") parsed.keepWorkdir = true;
    else if (name === "--summary") parsed.summary = true;
    else if (name === "--allow-custom-corpus") parsed.allowCustomCorpus = true;
    else if (name === "--help" || name === "-h") {
      console.log(`Usage: node --experimental-strip-types scripts/eval-external-holdout.ts [options]\n\nOptions:\n  --manifest <path>        Frozen manifest (default checked-in v1)\n  --oracle <path>          Complete fix-diff disposition audit\n  --cache-dir <path>       Clone/profile cache\n  --case <id>              Run one case for diagnosis\n  --evidence-output <path> Write deterministic full evidence JSON\n  --offline                Require an already populated cache\n  --quality-gate           Exit non-zero when declared gates fail\n  --summary                Omit per-case rows from stdout\n  --allow-custom-corpus    Explicitly run hashes other than frozen v1\n  --keep-workdir           Preserve per-run snapshots and indexes`);
      process.exit(0);
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else throw new Error(`Unexpected positional argument: ${arg}`);
  }
  return parsed;
}

function normalizeRemote(value: string): string {
  return value.replace(/\.git$/, "").replace(/\/$/, "");
}

function normalizeText(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[-./]+/g, " ");
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(term, offset)) !== -1) {
    count++;
    offset += term.length;
  }
  return count;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
