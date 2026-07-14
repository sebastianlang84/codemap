#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";
import { searchCodeMap } from "../src/core/search.ts";
import {
  evaluateSearchQualityGate,
  scoreSearchQualityCases,
  type SearchQualityCase,
  type SearchQualityMetrics,
} from "../src/core/search-quality-metrics.ts";

interface BenchmarkManifest {
  schemaVersion: 1;
  corpus: { id: string; version: number };
  splits: {
    development: BenchmarkCase[];
    holdout: BenchmarkCase[];
  };
  holdoutThresholds: HoldoutThresholds;
}

interface BenchmarkCase extends SearchQualityCase {
  id: string;
}

interface HoldoutThresholds {
  minTop1Accuracy: number;
  minRecallAt5: number;
  minMrrAt5: number;
  maxFalsePositiveRate: number;
  maxColdIndexLatencyMs: number;
  maxColdSearchLatencyMs: number;
  maxWarmP95LatencyMs: number;
  maxIndexBytes: number;
  maxPeakRssBytes: number;
}

interface SplitMetrics extends SearchQualityMetrics {
  falsePositiveRate: number;
}

interface GateIssue {
  metric: string;
  expected: string;
  actual: number;
}

const fixtureRoot = fileURLToPath(new URL("../tests/fixtures/semantic-quality/agent-navigation-v1", import.meta.url));
const manifestPath = fileURLToPath(new URL("../tests/fixtures/semantic-quality/agent-navigation-v1.json", import.meta.url));
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (arg !== "--fixtures" && arg !== "--quality-gate" && arg !== "--development-only") throw new Error(`Unknown option: ${arg}`);
}
if (args.has("--quality-gate") && args.has("--development-only")) {
  throw new Error("--quality-gate cannot be combined with --development-only");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BenchmarkManifest;
validateManifest(manifest);
const stateDir = mkdtempSync(join(tmpdir(), "codemap-semantic-benchmark-"));
process.on("exit", () => rmSync(stateDir, { recursive: true, force: true }));
const info = getRepoInfo(fixtureRoot);
const pathPrefix = relative(info.root, fixtureRoot).split("\\").join("/");
const indexStart = performance.now();
const indexed = indexRepo({ cwd: fixtureRoot, approve: true, pathPrefix, stateDir });
const coldIndexLatencyMs = round(performance.now() - indexStart);
const firstCase = manifest.splits.development[0];
const coldSearchStart = performance.now();
if (firstCase) search(firstCase.query);
const coldSearchLatencyMs = round(performance.now() - coldSearchStart);
const development = scoreSplit(manifest.splits.development);
const holdout = args.has("--development-only") ? undefined : scoreSplit(manifest.splits.holdout);
const resources = {
  coldIndexLatencyMs,
  coldSearchLatencyMs,
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  indexBytes: sqliteBytes(indexed.dbPath),
  embeddingLatencyMs: 0,
  modelBytes: 0,
};
const gate = holdout ? evaluateHoldoutGate(holdout, resources, manifest.holdoutThresholds) : undefined;

console.log(JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  generatedAt: new Date().toISOString(),
  profile: "lexical",
  corpus: manifest.corpus,
  splits: holdout ? { development, holdout } : { development },
  resources,
  ...(gate ? { gate: { evaluatedSplit: "holdout", thresholds: manifest.holdoutThresholds, ...gate } } : {}),
}, null, 2));
if (args.has("--quality-gate") && gate && !gate.passed) process.exitCode = 1;

function scoreSplit(cases: BenchmarkCase[]): SplitMetrics {
  const metrics = scoreSearchQualityCases(cases, search);
  return {
    ...metrics,
    falsePositiveRate: metrics.cases === 0 ? 0 : round((metrics.excludedHits?.length ?? 0) / metrics.cases),
  };
}

function search(query: string): string[] {
  return searchCodeMap({ cwd: fixtureRoot, query, limit: 5, pathPrefix, stateDir }).map((result) => {
    if (!pathPrefix) return result.path;
    return result.path.startsWith(`${pathPrefix}/`) ? result.path.slice(pathPrefix.length + 1) : result.path;
  });
}

function evaluateHoldoutGate(
  metrics: SplitMetrics,
  resources: { coldIndexLatencyMs: number; coldSearchLatencyMs: number; peakRssBytes: number; indexBytes: number },
  thresholds: HoldoutThresholds,
): { passed: boolean; issues: GateIssue[] } {
  const quality = evaluateSearchQualityGate(metrics, {
    minTop1Accuracy: thresholds.minTop1Accuracy,
    minRecallAt5: thresholds.minRecallAt5,
    minMrrAt5: thresholds.minMrrAt5,
    maxP95LatencyMs: thresholds.maxWarmP95LatencyMs,
    requireCases: true,
  }, "holdout");
  const issues: GateIssue[] = quality.issues.map(({ metric, expected, actual }) => ({ metric, expected, actual }));
  addMaxIssue(issues, "falsePositiveRate", metrics.falsePositiveRate, thresholds.maxFalsePositiveRate);
  addMaxIssue(issues, "coldIndexLatencyMs", resources.coldIndexLatencyMs, thresholds.maxColdIndexLatencyMs);
  addMaxIssue(issues, "coldSearchLatencyMs", resources.coldSearchLatencyMs, thresholds.maxColdSearchLatencyMs);
  addMaxIssue(issues, "indexBytes", resources.indexBytes, thresholds.maxIndexBytes);
  addMaxIssue(issues, "peakRssBytes", resources.peakRssBytes, thresholds.maxPeakRssBytes);
  return { passed: issues.length === 0, issues };
}

function addMaxIssue(issues: GateIssue[], metric: string, actual: number, maximum: number): void {
  if (actual > maximum) issues.push({ metric, expected: `<= ${maximum}`, actual });
}

function sqliteBytes(dbPath: string): number {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    .reduce((total, path) => total + (existsSync(path) ? statSync(path).size : 0), 0);
}

function validateManifest(value: BenchmarkManifest): void {
  if (value.schemaVersion !== 1) throw new Error(`Unsupported benchmark schema: ${value.schemaVersion}`);
  if (!value.corpus.id || value.corpus.version < 1) throw new Error("Benchmark corpus id and version are required");
  const allIds = new Set<string>();
  for (const [split, cases] of Object.entries(value.splits)) {
    if (cases.length === 0) throw new Error(`Benchmark split has no cases: ${split}`);
    for (const item of cases) {
      if (!item.id || allIds.has(item.id)) throw new Error(`Benchmark case id is missing or duplicated: ${item.id}`);
      if (!item.query || item.expectedPaths.length === 0) throw new Error(`Benchmark case is incomplete: ${item.id}`);
      for (const path of [...item.expectedPaths, ...(item.excludedPaths ?? [])]) {
        if (!existsSync(`${fixtureRoot}/${path}`)) throw new Error(`Benchmark case path does not exist: ${item.id}: ${path}`);
      }
      allIds.add(item.id);
    }
  }
  const rateThresholds = [
    value.holdoutThresholds.minTop1Accuracy,
    value.holdoutThresholds.minRecallAt5,
    value.holdoutThresholds.minMrrAt5,
    value.holdoutThresholds.maxFalsePositiveRate,
  ];
  if (rateThresholds.some((threshold) => !Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    throw new Error("Quality and false-positive thresholds must be between 0 and 1");
  }
  for (const [name, threshold] of Object.entries(value.holdoutThresholds)) {
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`Invalid holdout threshold: ${name}`);
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
