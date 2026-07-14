import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome("pi-codemap-semantic-quality-home-");

test("semantic development runs do not expose the holdout split", () => {
  const output = execFileSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/bench-semantic-quality.ts",
    "--fixtures",
    "--development-only",
  ], { encoding: "utf8" });
  const report = JSON.parse(output) as { splits: Record<string, unknown>; gate?: unknown };

  assert.deepEqual(Object.keys(report.splits), ["development"]);
  assert.equal(report.gate, undefined);
});

test("semantic benchmark exposes a fixed lexical baseline with dev and holdout metrics", () => {
  const output = execFileSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/bench-semantic-quality.ts",
    "--fixtures",
    "--quality-gate",
  ], { encoding: "utf8" });
  const report = JSON.parse(output) as {
    schemaVersion: number;
    profile: string;
    corpus: { id: string; version: number };
    splits: Record<string, {
      cases: number;
      top1Accuracy: number;
      recallAt5: number;
      mrrAt5: number;
      falsePositiveRate: number;
    }>;
    resources: {
      coldIndexLatencyMs: number;
      coldSearchLatencyMs: number;
      peakRssBytes: number;
      indexBytes: number;
      embeddingLatencyMs: number;
      modelBytes: number;
    };
    gate: {
      evaluatedSplit: string;
      passed: boolean;
      thresholds: {
        minTop1Accuracy: number;
        minRecallAt5: number;
        minMrrAt5: number;
        maxFalsePositiveRate: number;
      };
    };
  };

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.profile, "lexical");
  assert.deepEqual(report.corpus, { id: "agent-navigation-semantic-v1", version: 1 });
  assert.ok(report.splits.development?.cases >= 4);
  assert.ok(report.splits.holdout?.cases >= 4);
  assert.ok(report.splits.holdout?.top1Accuracy >= 0);
  assert.ok(report.splits.holdout?.recallAt5 >= 0);
  assert.ok(report.splits.holdout?.mrrAt5 >= 0);
  assert.ok(report.splits.holdout?.falsePositiveRate >= 0);
  assert.equal(report.splits.holdout?.top1Accuracy, 0.8);
  assert.equal(report.splits.holdout?.recallAt5, 0.8);
  assert.equal(report.splits.holdout?.mrrAt5, 0.8);
  assert.equal(report.splits.holdout?.falsePositiveRate, 0.2);
  assert.ok(report.resources.coldIndexLatencyMs >= 0);
  assert.ok(report.resources.coldSearchLatencyMs >= 0);
  assert.ok(report.resources.peakRssBytes > 0);
  assert.ok(report.resources.indexBytes > 0);
  assert.equal(report.resources.embeddingLatencyMs, 0);
  assert.equal(report.resources.modelBytes, 0);
  assert.equal(report.gate.evaluatedSplit, "holdout");
  assert.deepEqual({
    minTop1Accuracy: report.gate.thresholds.minTop1Accuracy,
    minRecallAt5: report.gate.thresholds.minRecallAt5,
    minMrrAt5: report.gate.thresholds.minMrrAt5,
    maxFalsePositiveRate: report.gate.thresholds.maxFalsePositiveRate,
  }, {
    minTop1Accuracy: 0.8,
    minRecallAt5: 0.8,
    minMrrAt5: 0.8,
    maxFalsePositiveRate: 0.2,
  });
  assert.equal(report.gate.passed, true);
});
