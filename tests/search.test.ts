import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo } = await import("../src/core/indexer.ts");
const { mergeSearchContextReadPlan } = await import("../src/core/navigation-read-plan.ts");
const { searchCodeMap } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");

test("codemap context resolves TypeScript path aliases from tsconfig paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-alias-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "app"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "root-wrong", "lib"), { recursive: true });

  const rootPaths: Record<string, string[]> = { "~/*": ["lib/*"], "@/*": ["root-wrong/*"] };
  for (let index = 0; index < 90; index++) rootPaths[`dummy-${index}/*`] = [`unused-${index}/*`];

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "page.ts"), `
import { formatHeadline } from "@/lib/headline";

export function renderPageHeadline(value: string) {
  return formatHeadline(value);
}
`);
  writeFileSync(join(root, "apps", "web", "src", "app", "missing-page.ts"), `
import { wrongAliasTarget } from "@/lib/missing";

export const missingPage = wrongAliasTarget;
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "headline.ts"), `
export function formatHeadline(value: string) {
  return value.toUpperCase();
}
`);
  writeFileSync(join(root, "jsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: rootPaths } }, null, 2));
  writeFileSync(join(root, "src", "app", "widget.js"), `
import { formatWidgetHeadline } from "~/headline";

export function renderWidget(value) {
  return formatWidgetHeadline(value);
}
`);
  writeFileSync(join(root, "src", "lib", "headline.js"), `
export function formatWidgetHeadline(value) {
  return value.toLowerCase();
}
`);
  writeFileSync(join(root, "src", "root-wrong", "lib", "headline.ts"), `
export const wrongAliasTarget = true;
`);
  writeFileSync(join(root, "src", "root-wrong", "lib", "missing.ts"), `
export const wrongAliasTarget = true;
`);

  indexRepo({ cwd: root, approve: true });

  const contextResult = codemapContext({ cwd: root, target: "apps/web/src/app/page.ts", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.ok(readFirstPaths.includes("apps/web/src/lib/headline.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("src/root-wrong/lib/headline.ts"), JSON.stringify(readFirstPaths));
  const headlineReason = contextResult.readFirst.find((item) => item.path === "apps/web/src/lib/headline.ts")?.reasons ?? [];
  assert.ok(headlineReason.some((reason) => reason.kind === "import" && reason.specifier === "@/lib/headline"), JSON.stringify(headlineReason));

  const missingContextResult = codemapContext({ cwd: root, target: "apps/web/src/app/missing-page.ts", limit: 5 });
  const missingReadFirstPaths = missingContextResult.readFirst.map((item) => item.path);
  assert.ok(!missingReadFirstPaths.includes("src/root-wrong/lib/missing.ts"), JSON.stringify(missingReadFirstPaths));

  const jsContextResult = codemapContext({ cwd: root, target: "src/app/widget.js", limit: 5 });
  const jsReadFirstPaths = jsContextResult.readFirst.map((item) => item.path);
  assert.ok(jsReadFirstPaths.includes("src/lib/headline.js"), JSON.stringify(jsReadFirstPaths));
  const jsHeadlineReason = jsContextResult.readFirst.find((item) => item.path === "src/lib/headline.js")?.reasons ?? [];
  assert.ok(jsHeadlineReason.some((reason) => reason.kind === "import" && reason.specifier === "~/headline"), JSON.stringify(jsHeadlineReason));
});

test("exact symbol matches rank above chunk matches", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approveUser", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
  assert.match(results[0]?.snippet ?? "", /approveUser/);
});

test("prefix symbol queries prefer matching symbols", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approve", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
});

test("symbol queries outrank broad implementation file chunks", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approveUser implementation", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
});

test("generic implementation search does not seed unrelated main entrypoints", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-generic-implementation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export function bootstrapEntrypoint() { return 'main app shell'; }\n");
  writeFileSync(join(root, "src", "retrieval.ts"), "export const retrievalHint = 'memory retrieval behavior lives here';\n");
  indexRepo({ cwd: root, approve: true });

  const genericResults = searchCodeMap({ cwd: root, query: "memory retrieval implementation", limit: 5 });
  assert.equal(genericResults[0]?.path, "src/retrieval.ts", JSON.stringify(genericResults));

  const mainResults = searchCodeMap({ cwd: root, query: "where is the main implementation?", limit: 5 });
  assert.equal(mainResults[0]?.path, "src/index.ts", JSON.stringify(mainResults));
});

test("natural binary change requests prefer source targets over agent instructions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-binary-change-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "ast-grep"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(join(root, "AGENTS.md"), `
# ast-grep binary guidance

The ast grep binary path may be ambiguous when sg is shadowed by another utils command.
The ast grep binary path install guidance belongs in source behavior, not this instruction file.
`);
  writeFileSync(join(root, "src", "ast-grep", "binary-path.ts"), `
export function resolveAstGrepBinaryPath(candidate: string) {
  if (candidate === "sg") throw new Error("ambiguous sg shadow utils command; install ast-grep");
  return candidate;
}
`);
  writeFileSync(join(root, "test", "binary-path.test.ts"), `
import { resolveAstGrepBinaryPath } from "../src/ast-grep/binary-path";

test("rejects ambiguous sg shadow utils command", () => resolveAstGrepBinaryPath("sg"));
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance", limit: 5 });
  const sourceIndex = results.findIndex((result) => result.path === "src/ast-grep/binary-path.ts");
  const agentIndex = results.findIndex((result) => result.path === "AGENTS.md");

  assert.equal(sourceIndex, 0, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
  assert.ok(agentIndex === -1 || agentIndex > sourceIndex, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("natural provider outage requests keep provider implementations in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-provider-outage-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "lib", "providers"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "types"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "lib", "dashboard-pipeline.ts"), `
import { deriveMacroSignals } from "./macro-derivations";
import { appendMarginDebtDerivedSeries } from "./margin-debt-derivations";
import { fetchFredSeries } from "./providers/fred";
import { fetchYahooSeries } from "./providers/yahoo";
import type { MacroSeries } from "../types/macro";

export interface ProviderDiagnostics {
  source: "fred" | "yahoo";
  seriesCount: number;
  withDataCount: number;
  errorCount: number;
}

export function summarizeProviderDiagnostics(series: MacroSeries[]): ProviderDiagnostics[] {
  return ["fred", "yahoo"].map((source) => ({
    source: source as "fred" | "yahoo",
    seriesCount: series.filter((item) => item.source === source).length,
    withDataCount: series.filter((item) => item.source === source && item.points.length > 0).length,
    errorCount: series.filter((item) => item.source === source && item.error).length,
  }));
}

export function dashboardProviderNoDataDiagnosticsShouldKeepFredAndYahooSeriesWhenOneMarketSourceIsEmpty(series: MacroSeries[]) {
  return summarizeProviderDiagnostics(series);
}

export async function runDashboardPipeline() {
  const series = appendMarginDebtDerivedSeries([
    await fetchFredSeries(),
    await fetchYahooSeries(),
  ]);
  return { diagnostics: dashboardProviderNoDataDiagnosticsShouldKeepFredAndYahooSeriesWhenOneMarketSourceIsEmpty(series), signals: deriveMacroSignals(series) };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "providers", "fred.ts"), `
export async function fetchFredSeries() {
  return { source: "fred", points: [], error: "FRED provider has no data" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "providers", "yahoo.ts"), `
export async function fetchYahooSeries() {
  return { source: "yahoo", points: [], error: "Yahoo market source is empty" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "macro-derivations.ts"), `
export function deriveMacroSignals(series: unknown[]) { return series.length; }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "margin-debt-derivations.ts"), `
export function appendMarginDebtDerivedSeries(series: unknown[]) { return series; }
`);
  writeFileSync(join(root, "apps", "web", "src", "types", "macro.ts"), `
export interface MacroSeries { source: "fred" | "yahoo"; points: unknown[]; error?: string; }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "dashboard-pipeline.test.ts"), `
import { summarizeProviderDiagnostics } from "../dashboard-pipeline";

test("keeps provider no data diagnostics for partial outages", () => {
  expect(summarizeProviderDiagnostics([{ source: "fred", points: [], error: "missing" }, { source: "yahoo", points: [1] }])).toHaveLength(2);
});
`);
  writeFileSync(join(root, "docs", "plans", "macro-data-integration.md"), `
# Newsletter macro data integration

Dashboard provider no data diagnostics should remain visible in newsletter plans.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "dashboard provider no data diagnostics should keep FRED and Yahoo series when one market source is empty";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/lib/dashboard-pipeline.ts",
    "apps/web/src/lib/__tests__/dashboard-pipeline.test.ts",
    "apps/web/src/lib/providers/fred.ts",
    "apps/web/src/lib/providers/yahoo.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural handoff preload requests keep implementation, test, and active ADRs in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-handoff-preload-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  mkdirSync(join(root, "docs", "archive", "plans"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), `
import { findLatestHandoffForTurn } from "./handoffs";

export function formatLatestHandoffLines(latestHandoff: { isFallback: boolean }) {
  return [\`Latest active handoff\${latestHandoff.isFallback ? " (fallback; do not overwrite unless explicit)" : ""}:\`];
}

export function buildTurnMemoryMessage() {
  const latestHandoff = findLatestHandoffForTurn();
  return formatLatestHandoffLines(latestHandoff);
}
`);
  writeFileSync(join(root, "src", "pi-extension", "handoffs.ts"), `
export function findLatestHandoffForTurn() {
  return { isFallback: true };
}
`);
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), `
import { buildTurnMemoryMessage } from "../../src/pi-extension/retrieval";

test("findLatestHandoffForTurn prefers exact session handoff before repo fallback", () => {
  expect(buildTurnMemoryMessage()).toContain("Latest active handoff");
});

test("fallback handoff preload warns agents not to overwrite it", () => {
  expect(buildTurnMemoryMessage()).toContain("fallback; do not overwrite unless explicit");
});
`);
  writeFileSync(join(root, "docs", "adr", "005-simplified-agent-facing-scopes.md"), `
# ADR 005 — Simplified agent-facing memory scopes

Use only global, repo, and session as normal agent-facing scopes. Session is short-lived handoff and current-run context; repo is durable repository context.
`);
  writeFileSync(join(root, "docs", "adr", "006-normal-and-advanced-tool-surface.md"), `
# ADR 006 — Normal and Advanced Tool Surface

The simplified scope model favors fewer normal paths: use global, repo, and session. The normal tool surface includes memory_list for active todos and handoffs and memory_save_handoff for explicit handoff writes.
`);
  writeFileSync(join(root, "docs", "adr", "007-memory-model-minimisation.md"), `
# ADR 007 — Memory model minimisation

### Handoff count warning

memory_save_handoff warns when several active handoffs already exist in the same repo.
`);
  writeFileSync(join(root, "docs", "archive", "plans", "memory-model-minimisation.md"), `
# Archived memory model minimisation plan

### Handoff count warning

Archived plan text about active handoff warnings should not displace current implementation, tests, and ADRs.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "active handoff preload should prefer current session before repo fallback and warn not to overwrite fallback handoffs";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "src/pi-extension/retrieval.ts",
    "test/pi-extension/retrieval.test.ts",
    "docs/adr/005-simplified-agent-facing-scopes.md",
    "docs/adr/006-normal-and-advanced-tool-surface.md",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural FastAPI run trigger requests keep compose deployment config in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-fastapi-compose-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "api"), { recursive: true });
  mkdirSync(join(root, "ui"), { recursive: true });

  writeFileSync(join(root, "api", "app.py"), `
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="fourier-cycles-api")

class TriggerRequest(BaseModel):
    confirm: bool = False

@app.post("/api/run")
def trigger_run(request: TriggerRequest):
    if not request.confirm:
        raise HTTPException(status_code=400, detail="set confirm=true to trigger a run")
    raise HTTPException(status_code=409, detail="run already in progress")
`);
  writeFileSync(join(root, "docker-compose.webapp.yml"), `
services:
  fourier-cycles-api:
    build:
      context: .
      dockerfile: api/Dockerfile
    environment:
      FOURIER_TRIGGER_MAX_RUNTIME_SECONDS: "5400"
`);
  writeFileSync(join(root, "PRD_webapp.md"), `
# Fourier Cycles Web App

Phase 2 includes POST /api/run as a controlled FastAPI trigger endpoint.
`);
  writeFileSync(join(root, "README.md"), "# Fourier cycles\n\nFastAPI run trigger docs.\n");
  writeFileSync(join(root, "requirements.txt"), "fastapi\npydantic\n");
  writeFileSync(join(root, "ui", "tsconfig.app.json"), JSON.stringify({ compilerOptions: {} }, null, 2));
  indexRepo({ cwd: root, approve: true });

  const query = "FastAPI confirm true run already in progress";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of ["api/app.py", "docker-compose.webapp.yml", "PRD_webapp.md"]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural reviewer context scout requests keep plan, benchmark, and fixtures in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-reviewer-scout-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  mkdirSync(join(root, "docs", "benchmarks"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });

  writeFileSync(join(root, "docs", "plans", "reviewer-context-scout.md"), `
# Reviewer context scout

The reviewer context scout should gather bounded contract and nearby test evidence without scout recursion.
It reads the benchmark fixtures and must not route through fanout reduce plans.
`);
  writeFileSync(join(root, "docs", "benchmarks", "reviewer-context-scout-fixtures.json"), JSON.stringify({ cases: [{ name: "bounded contract evidence", scoutRecursion: false }] }, null, 2));
  writeFileSync(join(root, "tests", "reviewer-context-scout-benchmark.test.mjs"), `
import fixtures from "../docs/benchmarks/reviewer-context-scout-fixtures.json" with { type: "json" };

test("reviewer context scout gathers bounded nearby test evidence without recursion", () => {
  assert.equal(fixtures.cases[0].scoutRecursion, false);
});
`);
  writeFileSync(join(root, "scripts", "score-reviewer-context-scout-benchmark.mjs"), `
import fixtures from "../docs/benchmarks/reviewer-context-scout-fixtures.json" with { type: "json" };
console.log(fixtures.cases.length);
`);
  for (const noisyTest of ["request.test.mjs", "token-injection.test.mjs", "agents.test.mjs", "display.test.mjs"]) {
    writeFileSync(join(root, "tests", noisyTest), `
test("ordinary unrelated test evidence", () => {
  assert.ok(true);
});
`);
  }
  writeFileSync(join(root, "docs", "plans", "fanout-reduce.md"), `
# Fanout reduce

Noisy scout recursion material that should not displace the reviewer context scout plan.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "reviewer context scout should gather bounded contract and nearby test evidence without scout recursion";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "docs/plans/reviewer-context-scout.md",
    "docs/benchmarks/reviewer-context-scout-fixtures.json",
    "tests/reviewer-context-scout-benchmark.test.mjs",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural binary install guidance requests keep README in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-binary-guidance-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "ast-grep"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(join(root, "README.md"), `
# ast-grep binary guidance

## Installation

Install ast-grep yourself first:

\`\`\`bash
cargo install ast-grep --locked
brew install ast-grep
npm install -g @ast-grep/cli
\`\`\`

## Binary trust model

The command name sg is ambiguous on Unix-like systems. Some systems provide sg from shadow-utils/newgrp.
This extension validates sg --version and rejects sg unless the version output identifies ast-grep.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| sg exists but is ignored | It is likely not ast-grep; install ast-grep or ensure ast-grep's sg appears first on PATH. |
`);
  writeFileSync(join(root, "src", "ast-grep", "binary-path.ts"), `
export function getCandidatePaths() {
  return ["ast-grep", "sg"];
}

export function findOnPath(baseName: "ast-grep" | "sg") {
  return getCandidatePaths().filter((candidate) => candidate === baseName);
}

export function getBinaryNames(baseName: "ast-grep" | "sg") {
  return [baseName];
}

export function runVersionCommand(binaryPath: string) {
  return binaryPath.includes("sg") ? "sg from shadow utils command" : "ast-grep";
}

export function isAstGrepVersionOutput(output: string) {
  return output.includes("ast-grep");
}

export function validateCandidate(candidate: string) {
  return isAstGrepVersionOutput(runVersionCommand(candidate));
}

export function resolveAstGrepBinaryPath(candidate: string) {
  if (candidate === "sg") throw new Error("ambiguous sg shadow utils command; install ast-grep");
  return candidate;
}
`);
  writeFileSync(join(root, "src", "ast-grep", "cli.ts"), `
import { resolveAstGrepBinaryPath } from "./binary-path";

export const INSTALL_HINT = "Install ast-grep locally with cargo install ast-grep --locked, brew install ast-grep, or npm install -g @ast-grep/cli. The sg command is accepted only when sg --version identifies ast-grep.";

export async function runSg(candidate: string) {
  return resolveAstGrepBinaryPath(candidate) ?? INSTALL_HINT;
}
`);
  writeFileSync(join(root, "src", "ast-grep", "tools.ts"), `
import { resolveAstGrepBinaryPath } from "./binary-path";
export const toolBinary = resolveAstGrepBinaryPath;
`);
  writeFileSync(join(root, "src", "index.ts"), `
export { resolveAstGrepBinaryPath } from "./ast-grep/binary-path";
`);
  writeFileSync(join(root, "test", "binary-path.test.ts"), `
import { resolveAstGrepBinaryPath } from "../src/ast-grep/binary-path";

test("rejects ambiguous sg shadow utils command", () => resolveAstGrepBinaryPath("sg"));
`);
  indexRepo({ cwd: root, approve: true });

  const query = "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of ["src/ast-grep/binary-path.ts", "test/binary-path.test.ts", "src/ast-grep/cli.ts", "README.md"]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural API endpoint requests keep route adapters in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-route-adapter-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "types"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
import { NextResponse } from "next/server";
import { buildNewsletterMacroSnapshot } from "@/lib/newsletter-macro-snapshot";

export async function GET() {
  return NextResponse.json(buildNewsletterMacroSnapshot({ generatedAt: new Date().toISOString(), series: [], warnings: [] }));
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "newsletter-macro-snapshot.ts"), `
import { latestPercentChange } from "@/lib/series-derivations";
import type { DashboardData, MacroSeries } from "@/types/macro";

type NewsletterMacroStatus = "ok" | "stale" | "unavailable" | "error";

const INDICATORS = [
  { key: "ism_manufacturing_pmi", source: "source_decision_needed", warning: "No verified source configured yet." },
  { key: "inflation_yoy", sourceKey: "cpi", derivation: "yoy" },
];

export function buildNewsletterMacroSnapshot(dashboard: DashboardData) {
  const generatedAt = dashboard.generatedAt;
  latestPercentChange([] as MacroSeries["points"], "yoy");
  return { schemaVersion: 1, generatedAt, indicators: INDICATORS, warnings: ["stale unavailable source decision warnings"] };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "series-derivations.ts"), `
export function latestPercentChange(points: Array<{ date: string; value: number }>, period: "mom" | "qoq" | "yoy") {
  return points.at(-1) ?? null;
}
`);
  writeFileSync(join(root, "apps", "web", "src", "types", "macro.ts"), `
export interface MacroSeries { points: Array<{ date: string; value: number }> }
export interface DashboardData { generatedAt: string; series: MacroSeries[]; warnings: string[] }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "newsletter-macro-snapshot.test.ts"), `
import { buildNewsletterMacroSnapshot } from "../newsletter-macro-snapshot";

test("surfaces stale unavailable source decision warnings", () => {
  expect(buildNewsletterMacroSnapshot({ generatedAt: "2025-01-01T00:00:00.000Z", series: [], warnings: [] }).warnings).toContain("stale unavailable source decision warnings");
});
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "series-derivations.test.ts"), `
import { latestPercentChange } from "../series-derivations";

test("computes latest percent changes", () => {
  expect(latestPercentChange([{ date: "2025-01-01", value: 1 }], "yoy")).toMatchObject({ value: 1 });
});
`);
  writeFileSync(join(root, "docs", "plans", "newsletter-macro-data-integration.md"), `
# Newsletter Macro Data Integration

The newsletter macro endpoint returns stale and unavailable source-decision warnings for missing indicators.
`);
  indexRepo({ cwd: root, approve: true });

  const targetContext = codemapContext({ cwd: root, target: "apps/web/src/lib/newsletter-macro-snapshot.ts", limit: 5 });
  assert.ok(targetContext.readFirst.some((item) => item.path === "apps/web/src/app/api/newsletter/macro/route.ts"), JSON.stringify(targetContext.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) }))));

  const query = "newsletter macro endpoint should return stale unavailable source decision warnings for missing macro indicators";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/lib/newsletter-macro-snapshot.ts",
    "apps/web/src/app/api/newsletter/macro/route.ts",
    "apps/web/src/lib/__tests__/newsletter-macro-snapshot.test.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural catalog endpoint requests keep route adapter, catalog source, and catalog test", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-catalog-endpoint-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "catalog"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "components"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "providers"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "catalog", "route.ts"), `
import { SERIES_CATALOG } from "@/lib/series-catalog";

export async function GET() {
  return Response.json(SERIES_CATALOG);
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "series-catalog.ts"), `
export interface SeriesSpec {
  key: string;
  label: string;
  providerId: string;
  source: "fred" | "yahoo";
}

export const SERIES_CATALOG: SeriesSpec[] = [
  { key: "sp500", label: "Macro dashboard dropdown series", providerId: "DUPLICATE", source: "yahoo" },
  { key: "vix", label: "Macro provider ids duplicate", providerId: "DUPLICATE", source: "yahoo" },
];
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "series-catalog.test.ts"), `
import { SERIES_CATALOG } from "../series-catalog";

test("provider ids are unique for dashboard dropdown", () => {
  expect(new Set(SERIES_CATALOG.map((series) => series.providerId)).size).toBe(SERIES_CATALOG.length);
});
`);
  for (const provider of ["finra", "fred", "yahoo"]) {
    writeFileSync(join(root, "apps", "web", "src", "lib", "providers", `${provider}.ts`), `
import type { SeriesSpec } from "@/lib/series-catalog";

export function fetch${provider}(series: SeriesSpec) {
  return { providerId: series.providerId, macro: true, dashboard: true, dropdown: "series" };
}
`);
  }
  writeFileSync(join(root, "apps", "web", "src", "components", "dashboard-client.tsx"), `
export function DashboardClient() {
  return <select>{["macro", "provider", "dashboard", "dropdown", "series"].map((item) => <option>{item}</option>)}</select>;
}
`);
  indexRepo({ cwd: root, approve: true });

  const query = "catalog endpoint returns duplicate macro provider ids and dashboard dropdown shows repeated series";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/app/api/catalog/route.ts",
    "apps/web/src/lib/series-catalog.ts",
    "apps/web/src/lib/__tests__/series-catalog.test.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural workbench session queries prefer source over local agent settings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-workbench-session-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });

  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
    permissions: { allow: ["Bash(curl:*)"] },
    spinnerTipsEnabled: true,
  }, null, 2));
  writeFileSync(join(root, "src", "lib", "use-series-workbench-session.ts"), `
export function restoreSeriesWorkbenchSession() {
  const saved = localStorage.getItem("series-workbench-session");
  return saved ? JSON.parse(saved) : { interval: "1d", range: "1y" };
}
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "workbench chart interval and x range settings should survive reload from local storage", limit: 5 });
  const sourceIndex = results.findIndex((result) => result.path === "src/lib/use-series-workbench-session.ts");
  const localSettingsIndex = results.findIndex((result) => result.path === ".claude/settings.local.json");

  assert.equal(sourceIndex, 0, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
  assert.ok(localSettingsIndex === -1 || localSettingsIndex > sourceIndex, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("implementation-intent queries prefer source targets over matching tests", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-implementation-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), `
export function registerMemoryTools() {
  return true;
}
`);
  writeFileSync(join(root, "test", "pi-extension", "tools.test.ts"), `
import { registerMemoryTools } from "../../src/pi-extension/tools";

// Repeated test-local helper methods should not saturate the implementation query candidate pool.
${Array.from({ length: 30 }, (_, index) => `export const testCase${index} = { registerMemoryTools() { return "implementation memory_search empty_result_hints near canonical keys near tag suggestions"; } };`).join("\n")}

test("registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions", () => {
  testCase0.registerMemoryTools();
});
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions", limit: 5 });

  assert.equal(results[0]?.path, "src/pi-extension/tools.ts", JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("python class and function symbols are searchable", (t) => {
  const root = fixtureRepo(t);
  assert.ok(searchCodeMap({ cwd: root, query: "DeliveryClient", limit: 5 }).some((result) => result.kind === "class"));
  assert.ok(searchCodeMap({ cwd: root, query: "send_telegram", limit: 5 }).some((result) => result.kind === "function"));
});

test("path-like queries return file matches first", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "tools.ts", limit: 5 });
  assert.equal(results[0]?.path, "src/pi-extension/tools.ts");
  assert.equal(results[0]?.kind, "file");
});

test("role-intent queries can surface main implementation files without lexical hits", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "where is the main implementation?", limit: 5 });
  assert.equal(results[0]?.path, "train.py");
  assert.equal(results[0]?.kind, "file");
});

test("endpoint route queries find route handlers before docs and generated noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-route-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
export async function GET() {
  const macroSnapshot = await loadMacroSnapshot();
  return Response.json({ macroSnapshot, channel: "newsletter" });
}

async function loadMacroSnapshot() {
  return { risk: "steady" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.test.ts"), `
import { GET } from "./route";

export const routeSmoke = GET;
`);
  writeFileSync(join(root, "docs", "newsletter-macro-api.md"), "# Newsletter macro API\n\nThe GET api newsletter macro snapshot endpoint is documented here.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "GET api newsletter macro snapshot endpoint" }, null, 2));
  writeFileSync(join(root, "dist", "route.js"), "export const generated = 'GET api newsletter macro snapshot endpoint';\n");

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "GET api newsletter macro snapshot endpoint", limit: 5 });
  assert.equal(results[0]?.path, "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(readFirstPaths.includes("apps/web/src/app/api/newsletter/macro/route.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/route.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("config-key queries find source config before docs and lockfile noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-config-key-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "src", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "config", "newsletter-macro.json"), JSON.stringify({ newsletterMacroSnapshotTtlMs: 900000, channel: "macro" }, null, 2));
  writeFileSync(join(root, "src", "newsletter", "macro-service.ts"), "export const macroSnapshotTtl = 900000;\n");
  writeFileSync(join(root, "docs", "newsletter-macro.md"), "# Newsletter macro\n\nOperators tune newsletterMacroSnapshotTtlMs in config.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "newsletterMacroSnapshotTtlMs config key" }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "newsletterMacroSnapshotTtlMs config key", limit: 5 });
  assert.equal(results[0]?.path, "config/newsletter-macro.json");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 4 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "config/newsletter-macro.json");
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("error-message queries find throwing source before docs and generated noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-error-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "newsletter"), { recursive: true });
  mkdirSync(join(root, "tests", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "newsletter", "snapshot-service.ts"), `
export function requireFreshSnapshot(snapshotAgeMs: number) {
  if (snapshotAgeMs > 900000) {
    throw new Error("ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old");
  }
  return true;
}
`);
  writeFileSync(join(root, "tests", "newsletter", "snapshot-service.test.ts"), `
import { requireFreshSnapshot } from "../../src/newsletter/snapshot-service";

export const staleSnapshotTest = requireFreshSnapshot;
`);
  writeFileSync(join(root, "docs", "newsletter-errors.md"), "# Newsletter errors\n\nERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old means operators should refresh data.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error" }, null, 2));
  writeFileSync(join(root, "dist", "snapshot-service.js"), "throw new Error('ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old');\n");

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error", limit: 5 });
  assert.equal(results[0]?.path, "src/newsletter/snapshot-service.ts");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "dist/snapshot-service.js"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/newsletter/snapshot-service.ts");
  assert.ok(readFirstPaths.includes("tests/newsletter/snapshot-service.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/snapshot-service.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("phrase queries find phrase-bearing docs without lockfile noise", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "\"ignored directory\"", limit: 5 });
  assert.equal(results[0]?.path, "docs/ops.md");
  assert.ok(results.every((result) => result.path !== "package-lock.json"));
});

test("lockfiles are indexed but only prominent for explicit lockfile queries", (t) => {
  const root = fixtureRepo(t);

  const dependencies = searchCodeMap({ cwd: root, query: "package dependencies leftpad", limit: 5 });
  assert.equal(dependencies[0]?.path, "package.json");
  assert.ok(dependencies.every((result) => result.path !== "package-lock.json"));

  const lockfile = searchCodeMap({ cwd: root, query: "package-lock.json", limit: 5 });
  assert.equal(lockfile[0]?.path, "package-lock.json");
});

test("navigation queries rank source config docs and tests before noisy files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-ranking-noise-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export function featureGateway() { return 'feature gateway source entrypoint'; }\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "feature-gateway", description: "feature gateway config", scripts: { test: "node --test" } }, null, 2));
  writeFileSync(join(root, "docs", "feature-gateway.md"), "# Feature gateway docs\n\nFeature gateway documentation for operators.\n");
  writeFileSync(join(root, "test", "feature-gateway.test.ts"), "import '../src/index';\n// feature gateway tests validate behavior\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, noise: "feature gateway config docs tests" }, null, 2));
  writeFileSync(join(root, "dist", "index.js"), "function featureGateway(){return 'feature gateway build output config docs tests'}\n");
  writeFileSync(join(root, "src", "__generated__", "feature-client.ts"), "export const generatedFeatureGateway = 'feature gateway generated config docs tests';\n");
  writeFileSync(join(root, "dist", "app.min.js"), "var featureGateway='feature gateway minified config docs tests';\n");
  writeFileSync(join(root, "data", "catalog.json"), JSON.stringify({ rows: Array.from({ length: 1500 }, (_, index) => ({ index, text: "feature gateway config docs tests noisy data" })) }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "feature gateway config docs tests", limit: 10 });
  const paths = results.map((result) => result.path);
  const useful = ["src/index.ts", "package.json", "docs/feature-gateway.md", "test/feature-gateway.test.ts"];
  const noisy = ["package-lock.json", "dist/index.js", "src/__generated__/feature-client.ts", "dist/app.min.js", "data/catalog.json"];
  const firstNoisyIndex = Math.min(...noisy.map((path) => paths.indexOf(path)).filter((index) => index >= 0));

  assert.ok(Number.isFinite(firstNoisyIndex), JSON.stringify(paths));
  for (const path of useful) {
    const index = paths.indexOf(path);
    assert.ok(index >= 0, `${path} missing from ${JSON.stringify(paths)}`);
    assert.ok(index < firstNoisyIndex, `${path} should rank before noisy files: ${JSON.stringify(paths)}`);
  }

  const jsonResults = searchCodeMap({ cwd: root, query: "feature gateway json config docs tests", limit: 10 });
  const jsonPaths = jsonResults.map((result) => result.path);
  const firstJsonNoisyIndex = Math.min(...noisy.map((path) => jsonPaths.indexOf(path)).filter((index) => index >= 0));
  const packageJsonIndex = jsonPaths.indexOf("package.json");
  assert.ok(Number.isFinite(firstJsonNoisyIndex), JSON.stringify(jsonPaths));
  assert.ok(packageJsonIndex >= 0, JSON.stringify(jsonPaths));
  assert.ok(packageJsonIndex < firstJsonNoisyIndex, JSON.stringify(jsonPaths));

  const explicitNoise = searchCodeMap({ cwd: root, query: "catalog.json", limit: 5 });
  assert.equal(explicitNoise[0]?.path, "data/catalog.json");
});

test("noisy queries keep source first and out of read-first neighbors", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-noisy-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "noisy-navigation.ts"), `
export function resolveNoisyNavigation() {
  return "generated bundle noise root cause source anchor";
}
`);
  writeFileSync(join(root, "src", "__generated__", "noisy-client.ts"), "export const generatedNoisyClient = 'generated bundle noise root cause source anchor';\n");
  writeFileSync(join(root, "dist", "noisy-navigation.js"), "function resolveNoisyNavigation(){return 'generated bundle noise root cause source anchor';}\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "generated bundle noise root cause source anchor" }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "generated bundle noise root cause source anchor", limit: 5 });
  assert.equal(results[0]?.path, "src/noisy-navigation.ts");
  assert.ok(results.every((result) => result.path !== "src/__generated__/noisy-client.ts"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "dist/noisy-navigation.js"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 4 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/noisy-navigation.ts");
  assert.ok(!readFirstPaths.includes("src/__generated__/noisy-client.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/noisy-navigation.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("natural module queries rank exact basename files above sibling config matches", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-module-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "newsletter_writer"), { recursive: true });

  writeFileSync(join(root, "src", "newsletter_writer", "config.py"), `
class TelegramConfig:
    delivery_log_path = "telegram delivery log"
`);
  writeFileSync(join(root, "src", "newsletter_writer", "delivery.py"), `
"""Telegram delivery: send newsletter messages via Bot API."""

def send_telegram(text):
    return text
`);

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "telegram delivery log host lock", limit: 5 });
  assert.equal(results[0]?.path, "src/newsletter_writer/delivery.py", JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("multi-term queries prefer all-term matches over OR fallback", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "alpha beta", limit: 5 });
  assert.equal(results[0]?.path, "docs/alpha-beta.md");
  assert.match(results[0]?.snippet ?? "", /alpha beta/i);
});

test("numeric queries remain searchable", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "404", limit: 5 });
  assert.equal(results[0]?.path, "src/core/numeric.ts");
  assert.match(results[0]?.snippet ?? "", /404/);
});
