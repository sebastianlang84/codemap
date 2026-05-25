import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { planQuery } = await import("../src/core/query-plan.ts");
const { scoreSearchRow } = await import("../src/core/ranking.ts");
const { searchCodeMap, searchCodeMapDebug } = await import("../src/core/search.ts");

test("ranking diagnostics expose score components without search API explain fields", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "package dependencies leftpad", limit: 5 });
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => !("diagnostics" in result) && !("scoreDiagnostics" in result)));

  const diagnostics = scoreSearchRow({
    path: "package-lock.json",
    language: "json",
    startLine: 1,
    endLine: 1,
    kind: "text",
    text: "leftpad dependencies package",
    rank: -3,
    symbolName: null,
  }, planQuery("package dependencies leftpad"), 1);

  assert.ok(diagnostics.finalScore < 0, JSON.stringify(diagnostics));
  assert.equal(diagnostics.retrievalBoost, 1);
  assert.ok(diagnostics.ftsScore > 0, JSON.stringify(diagnostics));
  assert.ok(diagnostics.tokenCoverage > 0, JSON.stringify(diagnostics));
  assert.deepEqual(diagnostics.matchedTokens.sort(), ["dependencies", "leftpad", "package"]);
  assert.ok(diagnostics.noisePenalty >= 60, JSON.stringify(diagnostics));
});

test("internal search debug report shows score components and candidate decisions", (t) => {
  const root = fixtureRepo(t);
  const publicResults = searchCodeMap({ cwd: root, query: "alpha beta", limit: 1 });
  const debug = searchCodeMapDebug({ cwd: root, query: "alpha beta", limit: 1 });

  assert.deepEqual(Object.keys(publicResults[0] ?? {}).sort(), ["endLine", "kind", "language", "path", "score", "snippet", "startLine"]);
  assert.deepEqual(debug.results, publicResults);
  assert.equal(debug.limit, 1);
  assert.ok(debug.candidates.some((candidate) => candidate.decision === "selected" && candidate.selectedRank === 1), JSON.stringify(debug.candidates));
  assert.ok(debug.candidates.some((candidate) => candidate.decision === "outside_limit" || candidate.decision === "deduped_lower_score"), JSON.stringify(debug.candidates));
  const selectedCandidate = debug.candidates.find((candidate) => candidate.decision === "selected");
  assert.ok(selectedCandidate, JSON.stringify(debug.candidates));
  assert.equal(typeof selectedCandidate.scoreDiagnostics.pathScore, "number");
  assert.ok(Array.isArray(selectedCandidate.scoreDiagnostics.matchedTokens));
});
