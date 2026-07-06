import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { registerCodeMapTools } from "../src/pi-extension/tools.ts";
import {
  assessTokenInjection,
  buildTokenInjectionReport,
  formatTokenInjectionReport,
  tokenInjectionTargets,
} from "../scripts/check-token-injection.ts";

// The token surface is a soft target, not a hard gate: these tests verify the cost is measured and
// over-target growth is surfaced for review — they do NOT fail on being over target. Minimizing the
// surface is a duty enforced by justification and the routing eval, not by a build-breaking cap.
test("registered CodeMap tools report a per-field token cost", () => {
  const tools: Array<{ name: string; description?: string; promptSnippet?: string; promptGuidelines?: string[]; parameters?: unknown }> = [];
  registerCodeMapTools({ registerTool: (tool: { name: string; description?: string; promptSnippet?: string; promptGuidelines?: string[]; parameters?: unknown }) => tools.push(tool) } as never);

  const report = buildTokenInjectionReport(tools);
  const assessment = assessTokenInjection(report, tokenInjectionTargets);

  assert.deepEqual(report.tools.map((tool) => tool.name).sort(), [
    "codemap_context",
    "codemap_index",
    "codemap_search",
    "codemap_status",
  ]);
  for (const tool of report.tools) {
    assert.ok(tool.fields.description.tokens > 0, `${tool.name} should count description tokens`);
    assert.ok(tool.fields.parameters.tokens > 0, `${tool.name} should count parameter-schema tokens`);
    assert.ok(tool.fields.promptGuidelines.tokens > 0, `${tool.name} should count promptGuidelines tokens`);
    assert.ok(tool.fields.promptSnippet.tokens > 0, `${tool.name} should count promptSnippet tokens`);
  }
  // Assessment is advisory: withinTarget is a boolean and any over-target tool is named for review.
  assert.equal(typeof assessment.withinTarget, "boolean");
  assert.ok(Array.isArray(assessment.warnings));
  for (const warning of assessment.warnings) {
    assert.ok(formatTokenInjectionReport(report, [warning]).includes(warning.label));
  }
});

test("a surface far over target is flagged, not silently accepted", () => {
  const report = buildTokenInjectionReport([
    { name: "codemap_bloat", description: "x".repeat(4000), promptSnippet: "s", promptGuidelines: ["g"], parameters: {} },
  ]);
  const assessment = assessTokenInjection(report, tokenInjectionTargets);
  assert.equal(assessment.withinTarget, false);
  assert.ok(assessment.warnings.some((warning) => warning.metric === "toolTokens"));
});

test("token-injection checker emits a machine-readable report and never fails", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/check-token-injection.ts"], { encoding: "utf8" });
  const report = JSON.parse(output) as { assessment?: { withinTarget?: boolean; warnings?: unknown[] }; tools?: Array<{ name?: string; total?: { tokens?: number } }>; totals?: { tokens?: number } };

  assert.equal(typeof report.assessment?.withinTarget, "boolean");
  assert.ok(Array.isArray(report.assessment?.warnings));
  assert.equal(report.tools?.length, 4);
  assert.ok((report.totals?.tokens ?? 0) > 0);
  assert.ok(report.tools?.every((tool) => typeof tool.name === "string" && (tool.total?.tokens ?? 0) > 0));
});
