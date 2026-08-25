import assert from "node:assert/strict";
import test from "node:test";

import { anonymizeUsageReport, buildUsageReport, parseUsageLines, type UsageEvent } from "../src/application/usage-report.ts";

// Fixed base time; offsets in minutes keep the sequence analyses readable and deterministic.
const BASE = Date.parse("2026-07-20T12:00:00.000Z");
function at(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}
function event(partial: Partial<UsageEvent> & { command: string; ts: string }): UsageEvent {
  return { v: 1, adapter: "cli", ...partial };
}

test("parseUsageLines keeps valid events, skips blanks, and counts malformed lines", () => {
  const lines = [
    JSON.stringify(event({ command: "search", ts: at(0) })),
    "",
    "   ",
    "{not json",
    JSON.stringify({ v: 1, ts: at(1) }), // missing command
    JSON.stringify({ v: 1, command: "search" }), // missing ts
    JSON.stringify({ v: 1, command: "search", ts: "not-a-date" }),
    JSON.stringify(event({ command: "index", ts: at(2) })),
  ];
  const { events, malformedLines } = parseUsageLines(lines);
  assert.equal(events.length, 2);
  assert.equal(malformedLines, 4);
  // sorted by ts
  assert.deepEqual(events.map((e) => e.command), ["search", "index"]);
});

test("outcomes aggregate percentiles, rates, and error kinds per command", () => {
  const events: UsageEvent[] = [
    event({ command: "search", ts: at(0), outcome: "ok", latency_ms: 10, stale: false, cap_hit: false, top_hit_confidence: "high", top_score: 5 }),
    event({ command: "search", ts: at(1), outcome: "empty", latency_ms: 30, stale: true, cap_hit: true, top_hit_confidence: "low", top_score: 1 }),
    event({ command: "search", ts: at(2), outcome: "error", latency_ms: 90, error_kind: "TypeError" }),
    event({ command: "index", ts: at(3), outcome: "ok", latency_ms: 200, approve: true, duration_ms: 200 }),
  ];
  const report = buildUsageReport(events, { malformedLines: 2 });
  assert.equal(report.overview.malformedLines, 2);

  const search = report.outcomes.find((c) => c.command === "search")!;
  assert.equal(search.total, 3);
  assert.deepEqual(search.byOutcome, { empty: 1, error: 1, ok: 1 });
  assert.deepEqual(search.errorKinds, { TypeError: 1 });
  assert.equal(search.latencyMsP50, 30);
  assert.equal(search.latencyMsP95, 90);
  assert.equal(search.search!.emptyRate, round(1 / 3));
  assert.equal(search.search!.staleRate, round(1 / 3));
  assert.equal(search.search!.capHitRate, round(1 / 3));

  const index = report.outcomes.find((c) => c.command === "index")!;
  assert.equal(index.index!.approveRate, 1);
  assert.equal(index.index!.durationMsP50, 200);
});

test("gate funnel counts repos through not_approved → approving index → search", () => {
  const events: UsageEvent[] = [
    // repo A: full path
    event({ command: "search", ts: at(0), repo_key: "A", outcome: "not_approved" }),
    event({ command: "index", ts: at(1), repo_key: "A", outcome: "ok", approve: true }),
    event({ command: "search", ts: at(2), repo_key: "A", outcome: "ok" }),
    // repo B: stops after the gate
    event({ command: "search", ts: at(0), repo_key: "B", outcome: "not_approved" }),
  ];
  const funnel = buildUsageReport(events).gateFunnel;
  assert.equal(funnel.notApprovedRepos, 2);
  assert.equal(funnel.notApprovedEvents, 2);
  assert.equal(funnel.approvedAfterGate, 1);
  assert.equal(funnel.searchedAfterApprove, 1);
});

test("gate funnel uses the first approval after a gate, not an older approval", () => {
  const events: UsageEvent[] = [
    event({ command: "index", ts: at(0), repo_key: "A", outcome: "ok", approve: true }),
    event({ command: "search", ts: at(1), repo_key: "A", outcome: "not_approved" }),
    event({ command: "index", ts: at(2), repo_key: "A", outcome: "ok", approve: true }),
    event({ command: "search", ts: at(3), repo_key: "A", outcome: "ok" }),
  ];
  const funnel = buildUsageReport(events).gateFunnel;
  assert.equal(funnel.approvedAfterGate, 1);
  assert.equal(funnel.searchedAfterApprove, 1);
});

test("stale→refresh honors the join window", () => {
  const withinWindow: UsageEvent[] = [
    event({ command: "search", ts: at(0), repo_key: "A", stale: true, outcome: "ok" }),
    event({ command: "index", ts: at(5), repo_key: "A", outcome: "ok" }),
    event({ command: "search", ts: at(6), repo_key: "A", outcome: "ok" }),
  ];
  const within = buildUsageReport(withinWindow, { joinWindowMs: 15 * 60_000 }).staleRefresh;
  assert.deepEqual(within, { staleSearches: 1, refreshedWithinWindow: 1, reSearchedAfterRefresh: 1 });

  const outsideWindow: UsageEvent[] = [
    event({ command: "search", ts: at(0), repo_key: "A", stale: true, outcome: "ok" }),
    event({ command: "index", ts: at(60), repo_key: "A", outcome: "ok" }), // 60m > 15m window
  ];
  const outside = buildUsageReport(outsideWindow, { joinWindowMs: 15 * 60_000 }).staleRefresh;
  assert.equal(outside.staleSearches, 1);
  assert.equal(outside.refreshedWithinWindow, 0);
});

test("search→context join ranks hits, prefers same agent, and flags recovered misses", () => {
  const events: UsageEvent[] = [
    // A different-agent search that would join at rank 1, and a same-agent search that joins at rank 2.
    event({ command: "search", ts: at(0), repo_key: "R", agent: { ppid_chain: "other" }, results: [{ path: "src/target.ts" }] }),
    event({ command: "search", ts: at(1), repo_key: "R", agent: { ppid_chain: "me" }, results: [{ path: "src/a.ts" }, { path: "src/target.ts" }] }),
    event({ command: "context", ts: at(2), repo_key: "R", agent: { ppid_chain: "me" }, target_form: "path", resolved_path: "src/target.ts" }),
    // recovered miss: prior search exists but the file was not among impressions
    event({ command: "search", ts: at(3), repo_key: "R", agent: { ppid_chain: "me" }, results: [{ path: "src/x.ts" }] }),
    event({ command: "context", ts: at(4), repo_key: "R", agent: { ppid_chain: "me" }, target_form: "path", resolved_path: "src/never-searched.ts" }),
    // query-form context is counted separately, never joined
    event({ command: "context", ts: at(5), repo_key: "R", target_form: "query", target: "how does auth work" }),
    // unjoinable: no prior in-window search for this repo
    event({ command: "context", ts: at(6), repo_key: "Z", target_form: "path", resolved_path: "src/lonely.ts" }),
  ];
  const join = buildUsageReport(events, { joinWindowMs: 15 * 60_000 }).searchContextJoin;
  assert.equal(join.pathContexts, 3);
  assert.equal(join.queryContexts, 1);
  assert.equal(join.joined, 1);
  assert.equal(join.recoveredMisses, 1);
  assert.equal(join.unjoinable, 1);
  // same-agent ("me") search wins over the earlier "other" search → rank 2, not rank 1.
  assert.deepEqual(join.rankHistogram, { "2": 1 });
  assert.equal(join.topRankHits, 0);
  assert.equal(join.meanRank, 2);
});

test("search→context joins the latest prior impression containing the opened path", () => {
  const events: UsageEvent[] = [
    event({ command: "search", ts: at(0), repo_key: "R", agent: { ppid_chain: "me" }, results: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }),
    event({ command: "search", ts: at(1), repo_key: "R", agent: { ppid_chain: "me" }, results: [{ path: "src/other.ts" }] }),
    event({ command: "context", ts: at(2), repo_key: "R", agent: { ppid_chain: "me" }, target_form: "path", resolved_path: "src/a.ts" }),
    event({ command: "search", ts: at(3), repo_key: "R", results: [{ path: "src/c.ts" }, { path: "src/d.ts" }, { path: "src/e.ts" }] }),
    event({ command: "context", ts: at(4), repo_key: "R", target_form: "path", resolved_path: "src/e.ts" }),
  ];
  const join = buildUsageReport(events).searchContextJoin;
  assert.equal(join.joined, 2);
  assert.equal(join.recoveredMisses, 0);
  assert.deepEqual(join.rankHistogram, { "1": 1, "3": 1 });
});

test("overview buckets adapter and version, defaulting a missing adapter to unknown", () => {
  const events: UsageEvent[] = [
    event({ command: "search", ts: at(0), adapter: "mcp", tool_version: "0.9.0", agent: { harness: "claude_code", ppid_chain: "p1" } }),
    { v: 1, command: "search", ts: at(1), tool_version: "0.9.0" }, // no adapter
  ];
  const o = buildUsageReport(events).overview;
  assert.deepEqual(o.byAdapter, { mcp: 1, unknown: 1 });
  assert.deepEqual(o.byToolVersion, { "0.9.0": 2 });
  assert.deepEqual(o.byHarness, { claude_code: 1 });
  assert.equal(o.distinctAgents, 1);
});

test("repo aggregates and joins never merge unrelated events that lack a repository", () => {
  const events: UsageEvent[] = [
    event({ command: "search", ts: at(0), outcome: "not_approved", stale: true, results: [{ path: "src/private.ts" }] }),
    event({ command: "index", ts: at(1), outcome: "ok", approve: true }),
    event({ command: "search", ts: at(2), outcome: "ok" }),
    event({ command: "context", ts: at(3), target_form: "path", resolved_path: "src/private.ts" }),
  ];
  const report = buildUsageReport(events);
  assert.equal(report.overview.distinctRepos, 0);
  assert.deepEqual(report.gateFunnel, {
    notApprovedRepos: 0,
    notApprovedEvents: 1,
    approvedAfterGate: 0,
    searchedAfterApprove: 0,
  });
  assert.deepEqual(report.staleRefresh, {
    staleSearches: 1,
    refreshedWithinWindow: 0,
    reSearchedAfterRefresh: 0,
  });
  assert.equal(report.searchContextJoin.joined, 0);
  assert.equal(report.searchContextJoin.unjoinable, 1);
});

test("anonymized report keeps product metrics without leaking local identifiers or raw navigation data", () => {
  const privateRoot = "/home/alice/private/acme";
  const privateState = "/home/alice/.local/share/codemap";
  const events: UsageEvent[] = [
    event({
      command: "search",
      ts: "2026-07-20T12:34:56.000Z",
      repo_key: "stable-private-repo-key",
      repo_root: privateRoot,
      cwd: `${privateRoot}/packages/api`,
      query: "customer-secret implementation",
      path_prefix: "packages/api",
      agent: { ppid_chain: "private-process-chain", harness: "claude_code", session: "private-session" },
      outcome: "ok",
      results: [{ path: "packages/api/src/customer-secret.ts", score: 42, kind: "text", language: "typescript" }],
    }),
    event({
      command: "context",
      ts: "2026-07-21T01:02:03.000Z",
      repo_key: "stable-private-repo-key",
      target: "packages/api/src/customer-secret.ts",
      target_form: "path",
      resolved_path: "packages/api/src/customer-secret.ts",
      outcome: "ok",
    }),
  ];

  const report = anonymizeUsageReport(buildUsageReport(events));
  assert.equal(report.reportVersion, 1);
  assert.equal(report.privacy, "aggregate");
  assert.deepEqual(report.period, { firstDate: "2026-07-20", lastDate: "2026-07-21" });
  assert.equal(report.overview.distinctRepos, 1);
  assert.deepEqual(report.overview.byHarness, { claude_code: 1 });

  const serialized = JSON.stringify(report);
  for (const secret of [
    privateState,
    privateRoot,
    "stable-private-repo-key",
    "customer-secret",
    "packages/api",
    "private-process-chain",
    "private-session",
    "12:34:56",
  ]) {
    assert.equal(serialized.includes(secret), false, `anonymized report leaked ${secret}`);
  }
  assert.equal("perRepo" in report, false);
  assert.equal("distinctAgents" in report.overview, false);
});

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
