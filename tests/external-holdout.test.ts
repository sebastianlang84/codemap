import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareHoldoutSelections,
  evaluateExternalHoldoutGate,
  hashJson,
  parseCliJson,
  parseExternalHoldoutManifest,
  parseExternalHoldoutOracleAudit,
  scoreHoldoutSelection,
  summarizeHoldoutMode,
  type ExternalHoldoutManifest,
  type HoldoutCaseResult,
  type HoldoutModeMetrics,
} from "../scripts/eval-external-holdout-lib.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

test("checked-in external corpus is frozen at forty cases across six repositories", () => {
  const path = new URL("../scripts/eval-external-holdout.manifest.json", import.meta.url);
  const raw = readFileSync(path, "utf8");
  const actual = parseExternalHoldoutManifest(raw);
  const manifestHash = hashJson(JSON.parse(raw));
  assert.equal(manifestHash, "94a8cb51d6bdb822855e1de6b821c33d893c7bf47069f057f43f6133c2f599af");
  assert.equal(actual.cases.length, 40);
  assert.equal(actual.repositories.length, 6);
  assert.equal(new Set(actual.cases.map((item) => item.repo)).size, 6);
  assert.equal(actual.gates.minCases, 40);
  assert.equal(actual.gates.minRepos, 6);

  const oracleRaw = readFileSync(new URL("../scripts/eval-external-holdout.oracle.json", import.meta.url), "utf8");
  assert.equal(hashJson(JSON.parse(oracleRaw)), "0f53d7d6cdaefca5836755fa4aecf99a8b69e3f75c6b0ae50f511d3e7145a163");
  const oracle = parseExternalHoldoutOracleAudit(oracleRaw, actual, manifestHash);
  assert.equal(oracle.exclusions.length, 18);

  const evidenceRaw = readFileSync(new URL("../docs/developer/external-holdout-v1-result.json", import.meta.url), "utf8");
  assert.equal(hashJson(JSON.parse(evidenceRaw)), "0bcd5d1b9534d762822bd07ac9e39d4590fb25753a2e0e780d71373e104a10cc");
  const evidence = JSON.parse(evidenceRaw) as { manifestSha256: string; qualitativeResultSha256: string; cases: unknown[] };
  assert.equal(evidence.manifestSha256, manifestHash);
  assert.equal(evidence.qualitativeResultSha256, "b3ebe357dfba046bad8731f8da4c7990b9db28ad1730a880695396d75a4f43f0");
  assert.equal(evidence.cases.length, 200);
});

function manifest(): ExternalHoldoutManifest {
  return {
    schemaVersion: 1,
    corpus: { id: "external-v1", version: 1, frozenAt: "2026-08-25", selectionProtocol: "fixed before first run" },
    budget: { files: 5 },
    profiles: [
      { id: "old", gitCommit: SHA_A, expectedVersion: "0.9.0" },
      { id: "new", gitCommit: SHA_B, expectedVersion: "0.9.1" },
    ],
    repositories: [{ id: "repo", remote: "https://github.com/example/repo.git" }],
    cases: [{ id: "repo-pr-1", repo: "repo", sourceUrl: "https://github.com/example/repo/pull/1", query: "fix the parser", baseCommit: SHA_A, fixCommit: SHA_B, expectedPaths: ["src/parser.ts"] }],
    gates: {
      candidateProfile: "new",
      baselineProfile: "old",
      minCases: 1,
      minRepos: 1,
      minSuccessDeltaVsLexical: 0.1,
      maxTokenRatioVsLexical: 0.75,
      minSuccessDeltaVsBaseline: 0,
    },
  };
}

test("external manifest rejects duplicate ids, abbreviated SHAs, and path escapes", () => {
  assert.deepEqual(parseExternalHoldoutManifest(JSON.stringify(manifest())), manifest());

  const duplicate = manifest();
  duplicate.cases.push({ ...duplicate.cases[0] });
  assert.throws(() => parseExternalHoldoutManifest(JSON.stringify(duplicate)), /Duplicate case id/);

  const abbreviated = manifest();
  abbreviated.cases[0].baseCommit = "abc123";
  assert.throws(() => parseExternalHoldoutManifest(JSON.stringify(abbreviated)), /40-character Git SHA/);

  const escape = manifest();
  escape.cases[0].expectedPaths = ["../private.ts"];
  assert.throws(() => parseExternalHoldoutManifest(JSON.stringify(escape)), /inside the repository/);

  const wrongRepo = manifest();
  wrongRepo.cases[0].sourceUrl = "https://github.com/elsewhere/repo/pull/1";
  assert.throws(() => parseExternalHoldoutManifest(JSON.stringify(wrongRepo)), /must reference a pull request/);
});

test("selection scoring is set-based, budget-aware, and reports exact misses", () => {
  const result = scoreHoldoutSelection({
    caseId: "case",
    repo: "repo",
    profile: "new",
    mode: "context",
    expectedPaths: ["src/a.ts", "test/a.test.ts"],
    filesRead: ["src/a.ts", "src/a.ts", "src/noise.ts"],
    bytesRead: 120,
    latencyMs: 10,
  });
  assert.deepEqual(result.filesRead, ["src/a.ts", "src/noise.ts"]);
  assert.deepEqual(result.missingPaths, ["test/a.test.ts"]);
  assert.equal(result.recall, 0.5);
  assert.equal(result.success, false);
});

test("external gate keeps the predeclared quality and token boundaries exact", () => {
  const spec = manifest();
  const metrics: HoldoutModeMetrics[] = [
    metric("frozen-lexical", "lexical", 0.5, 1000),
    metric("old", "context", 0.6, 700),
    metric("new", "context", 0.6, 750),
  ];
  const atBoundary = evaluateExternalHoldoutGate(spec, metrics, { cases: 1, repos: 1 });
  assert.equal(atBoundary.passed, true);
  assert.equal(atBoundary.successDeltaVsLexical, 0.1);
  assert.equal(atBoundary.tokenRatioVsLexical, 0.75);

  metrics[2] = metric("new", "context", 0.5999, 751);
  const below = evaluateExternalHoldoutGate(spec, metrics, { cases: 1, repos: 1 });
  assert.equal(below.passed, false);
  assert.deepEqual(below.issues.map((item) => item.metric), ["successDeltaVsLexical", "tokenRatioVsLexical", "successDeltaVsBaseline"]);
});

test("mode summaries and CLI JSON parsing stay deterministic and strict", () => {
  const cases: HoldoutCaseResult[] = [
    scoreHoldoutSelection({ caseId: "b", repo: "repo", profile: "new", mode: "context", expectedPaths: ["b.ts"], filesRead: ["b.ts"], bytesRead: 400, latencyMs: 20 }),
    scoreHoldoutSelection({ caseId: "a", repo: "repo", profile: "new", mode: "context", expectedPaths: ["a.ts"], filesRead: [], bytesRead: 0, latencyMs: 10 }),
  ];
  assert.deepEqual(summarizeHoldoutMode("new", "context", cases), {
    profile: "new",
    mode: "context",
    tasks: 2,
    successRate: 0.5,
    avgRecall: 0.5,
    avgFilesRead: 0.5,
    avgBytesRead: 200,
    estTokensRead: 50,
    avgLatencyMs: 15,
  });
  assert.deepEqual(parseCliJson('{"ok":true}', "search"), { ok: true });
  assert.throws(() => parseCliJson("not-json", "search"), /malformed JSON/);
  assert.throws(() => parseCliJson("[]", "search"), /non-object JSON/);
});

test("paired diagnostics expose success and partial-recall tradeoffs without changing gates", () => {
  const cases: HoldoutCaseResult[] = [
    scoreHoldoutSelection({ caseId: "win", repo: "r", profile: "new", mode: "context", expectedPaths: ["a", "b"], filesRead: ["a", "b"], bytesRead: 1, latencyMs: 1 }),
    scoreHoldoutSelection({ caseId: "win", repo: "r", profile: "old", mode: "context", expectedPaths: ["a", "b"], filesRead: ["a"], bytesRead: 1, latencyMs: 1 }),
    scoreHoldoutSelection({ caseId: "loss", repo: "r", profile: "new", mode: "context", expectedPaths: ["a", "b"], filesRead: ["a"], bytesRead: 1, latencyMs: 1 }),
    scoreHoldoutSelection({ caseId: "loss", repo: "r", profile: "old", mode: "context", expectedPaths: ["a", "b"], filesRead: ["a", "b"], bytesRead: 1, latencyMs: 1 }),
    scoreHoldoutSelection({ caseId: "tie", repo: "r", profile: "new", mode: "context", expectedPaths: ["a"], filesRead: [], bytesRead: 1, latencyMs: 1 }),
    scoreHoldoutSelection({ caseId: "tie", repo: "r", profile: "old", mode: "context", expectedPaths: ["a"], filesRead: [], bytesRead: 1, latencyMs: 1 }),
  ];
  assert.deepEqual(compareHoldoutSelections(cases, { profile: "new", mode: "context" }, { profile: "old", mode: "context" }), {
    pairs: 3,
    successWins: 1,
    successLosses: 1,
    successTies: 1,
    recallWins: 1,
    recallLosses: 1,
    recallTies: 1,
    twoSidedExactP: 1,
    successLosingCases: ["loss"],
    recallLosingCases: ["loss"],
  });
});

function metric(profile: string, mode: "lexical" | "context", successRate: number, estTokensRead: number): HoldoutModeMetrics {
  return { profile, mode, tasks: 1, successRate, avgRecall: successRate, avgFilesRead: 1, avgBytesRead: estTokensRead * 4, estTokensRead, avgLatencyMs: 1 };
}
