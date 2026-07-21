#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildUsageReport, parseUsageLines, type UsageEvent, type UsageReport } from "../src/application/usage-report.ts";
import { repoKey, resolveStateDir } from "../src/core/repo.ts";

// Read-only offline analyzer for usage.jsonl (ADR 0001 phase 2). Reads the rotated `.1` generation and
// the current log, hands the lines to the pure builder, and prints a deterministic report. It never
// writes state, never indexes, and never calls the ranking path.

interface ParsedArgs {
  json: boolean;
  stateDir?: string;
  repo?: string;
  since?: string;
  windowMinutes: number;
}

const USAGE_LOG_NAME = "usage.jsonl";
const parsed = parseArgs(process.argv.slice(2));
const stateDir = resolveStateDir(parsed.stateDir);

// Chronological across the rotation boundary: the older `.1` first, then the live log. parseUsageLines
// re-sorts by timestamp regardless, so a missing generation is harmless.
const lines: string[] = [];
for (const name of [`${USAGE_LOG_NAME}.1`, USAGE_LOG_NAME]) {
  const path = join(stateDir, name);
  if (existsSync(path)) lines.push(...readFileSync(path, "utf8").split("\n"));
}

if (lines.every((line) => line.trim().length === 0)) {
  console.error(`No usage data recorded yet under ${stateDir}. Run some codemap commands first.`);
  process.exit(0);
}

const { events, malformedLines } = parseUsageLines(lines);
const filtered = applyFilters(events, parsed);
const report = buildUsageReport(filtered, { malformedLines, joinWindowMs: parsed.windowMinutes * 60 * 1000 });

if (parsed.json) {
  console.log(JSON.stringify({ generatedFrom: stateDir, filesRead: lines.length > 0, ...report }, null, 2));
} else {
  console.log(renderText(report, stateDir));
}

function applyFilters(events: UsageEvent[], args: ParsedArgs): UsageEvent[] {
  let result = events;
  if (args.repo) {
    const needle = args.repo;
    let key: string | undefined;
    try {
      key = existsSync(needle) ? repoKey(needle) : undefined;
    } catch {
      key = undefined;
    }
    result = result.filter((event) => event.repo_key === needle || event.repo_root === needle || (key !== undefined && event.repo_key === key));
  }
  if (args.since) {
    const since = Date.parse(args.since);
    if (Number.isFinite(since)) result = result.filter((event) => typeof event.ts === "string" && Date.parse(event.ts) >= since);
  }
  return result;
}

function renderText(report: UsageReport, stateDir: string): string {
  const lines: string[] = [];
  const { overview: o } = report;
  lines.push(`CodeMap usage report — ${stateDir}`);
  lines.push(`window: ${Math.round(report.joinWindowMs / 60000)}m join`);
  lines.push("");
  lines.push("== overview ==");
  lines.push(`events:        ${o.totalEvents}${o.malformedLines ? ` (+${o.malformedLines} malformed lines skipped)` : ""}`);
  if (o.firstEvent) lines.push(`span:          ${o.firstEvent} → ${o.lastEvent}`);
  lines.push(`distinct repos: ${o.distinctRepos}   distinct agents: ${o.distinctAgents}`);
  lines.push(`by command:    ${fmtRecord(o.byCommand)}`);
  lines.push(`by adapter:    ${fmtRecord(o.byAdapter)}`);
  if (Object.keys(o.byHarness).length) lines.push(`by harness:    ${fmtRecord(o.byHarness)}`);
  lines.push(`by version:    ${fmtRecord(o.byToolVersion)}`);

  lines.push("");
  lines.push("== outcomes ==");
  for (const c of report.outcomes) {
    lines.push(`${c.command} (${c.total}): ${fmtRecord(c.byOutcome)}  p50=${c.latencyMsP50 ?? "-"}ms p95=${c.latencyMsP95 ?? "-"}ms`);
    if (Object.keys(c.errorKinds).length) lines.push(`  errors: ${fmtRecord(c.errorKinds)}`);
    if (c.search) lines.push(`  empty=${pct(c.search.emptyRate)} cap_hit=${pct(c.search.capHitRate)} stale=${pct(c.search.staleRate)} topScoreP50=${c.search.topScoreP50 ?? "-"} confidence=${fmtRecord(c.search.topHitConfidence)}`);
    if (c.index) lines.push(`  approve=${pct(c.index.approveRate)} duration p50=${c.index.durationMsP50 ?? "-"}ms p95=${c.index.durationMsP95 ?? "-"}ms`);
  }

  lines.push("");
  lines.push("== gate funnel (not_approved → approving index → search) ==");
  const g = report.gateFunnel;
  lines.push(`not_approved repos: ${g.notApprovedRepos} (${g.notApprovedEvents} events) → approved: ${g.approvedAfterGate} → searched: ${g.searchedAfterApprove}`);

  lines.push("");
  lines.push("== stale → refresh ==");
  const s = report.staleRefresh;
  lines.push(`stale searches: ${s.staleSearches} → refreshed in-window: ${s.refreshedWithinWindow} → re-searched: ${s.reSearchedAfterRefresh}`);

  lines.push("");
  lines.push("== search → context join ==");
  const j = report.searchContextJoin;
  lines.push(`path contexts: ${j.pathContexts}  query contexts: ${j.queryContexts}`);
  lines.push(`joined: ${j.joined} (top-1: ${j.topRankHits}, meanRank: ${j.meanRank ?? "-"})  recovered-miss (lower bound): ${j.recoveredMisses}  unjoinable: ${j.unjoinable}`);
  if (Object.keys(j.rankHistogram).length) lines.push(`rank histogram: ${fmtRecord(j.rankHistogram)}`);

  lines.push("");
  lines.push("== per repo ==");
  for (const r of report.perRepo) {
    lines.push(`${r.repo}  last=${r.lastActivity ?? "-"}  ${fmtRecord(r.byCommand)}`);
  }

  lines.push("");
  lines.push("Caveats: adapter=unknown covers direct library calls (tests/scripts). ppid_chain join is a");
  lines.push("Linux best-effort heuristic (caveat F); recovered-miss is a lower bound — a context whose file");
  lines.push("was never in a prior in-window search cannot be distinguished from no prior search at all.");
  return lines.join("\n");
}

function fmtRecord(record: Record<string, number>): string {
  const entries = Object.entries(record);
  return entries.length === 0 ? "(none)" : entries.map(([key, count]) => `${key}=${count}`).join(" ");
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, windowMinutes: 15 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = () => inlineValue ?? args[++i];
    if (name === "--json") parsed.json = true;
    else if (name === "--state-dir") parsed.stateDir = value();
    else if (name === "--repo" || name === "--repo-path") parsed.repo = value();
    else if (name === "--since") parsed.since = value();
    else if (name === "--window") parsed.windowMinutes = Math.max(1, Number(value()) || 15);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(`Usage: node --experimental-strip-types scripts/report-usage.ts [options]

Read-only analyzer for the local usage.jsonl telemetry log (ADR 0001 phase 2).

Options:
  --state-dir <path>   Log location (overrides CODEMAP_HOME/XDG default)
  --repo <root|key>    Filter to one repo (path is resolved to its repo key)
  --since <YYYY-MM-DD>  Only events at or after this date
  --window <minutes>   Join window for stale→refresh and search→context (default 15)
  --json               Emit the raw report object`);
}
