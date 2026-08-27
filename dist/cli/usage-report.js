import { readAnonymizedUsageReport } from "../application/usage-report-file.js";
const USAGE = `Usage: codemap usage-report [options]

Read aggregate product-usage metrics from the local telemetry log. The report omits raw queries,
targets, paths, repository IDs, process/session IDs, exact timestamps, and the state directory.

Options:
  --state-dir <path>    Log location (overrides CODEMAP_HOME/XDG default)
  --repo <root|key>     Filter to one repository before aggregation
  --since <YYYY-MM-DD>  Only include events on or after this UTC date
  --window <minutes>    Join window for related events (default 15)
  --json                Emit machine-readable aggregate JSON
  --help                Show this help`;
export function runUsageReportCli(argv) {
    let parsed;
    try {
        if (argv.includes("--help") || argv.includes("-h"))
            return ok(USAGE);
        parsed = parseArgs(argv);
    }
    catch (error) {
        return fail(error instanceof Error ? error.message : String(error), 2);
    }
    try {
        const report = readAnonymizedUsageReport({
            stateDir: parsed.stateDir,
            repo: parsed.repo,
            sinceMs: parsed.sinceMs,
            joinWindowMs: parsed.windowMinutes * 60_000,
        });
        return ok(parsed.json ? JSON.stringify(report, null, 2) : renderText(report));
    }
    catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
    }
}
function parseArgs(args) {
    const parsed = { json: false, windowMinutes: 15 };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const eq = arg.indexOf("=");
        const name = arg.startsWith("--") && eq !== -1 ? arg.slice(0, eq) : arg;
        const inlineValue = arg.startsWith("--") && eq !== -1 ? arg.slice(eq + 1) : undefined;
        const value = () => {
            const result = inlineValue ?? args[++i];
            if (result === undefined || result.trim() === "")
                throw new Error(`${name} requires a value`);
            return result;
        };
        if (name === "--json")
            parsed.json = true;
        else if (name === "--state-dir")
            parsed.stateDir = value();
        else if (name === "--repo" || name === "--repo-path")
            parsed.repo = value();
        else if (name === "--since")
            parsed.sinceMs = parseUtcDate(value());
        else if (name === "--window")
            parsed.windowMinutes = parsePositiveInteger(name, value());
        else if (arg.startsWith("--"))
            throw new Error(`Unknown option: ${arg}`);
        else
            throw new Error(`Unexpected positional argument: ${arg}`);
    }
    return parsed;
}
function parseUtcDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`--since requires YYYY-MM-DD, got: ${value}`);
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
        throw new Error(`--since requires a real UTC date, got: ${value}`);
    }
    return parsed;
}
function parsePositiveInteger(name, value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error(`${name} requires a positive integer, got: ${value}`);
    return parsed;
}
function renderText(report) {
    const lines = [
        "CodeMap usage report (anonymized, local)",
        `period: ${report.period.firstDate ?? "-"} → ${report.period.lastDate ?? "-"}`,
        `window: ${Math.round(report.joinWindowMs / 60_000)}m join`,
        "",
        "== overview ==",
        `events: ${report.overview.totalEvents}${report.overview.malformedLines ? ` (+${report.overview.malformedLines} malformed lines skipped)` : ""}`,
        `distinct repos: ${report.overview.distinctRepos}`,
        `by command: ${fmtRecord(report.overview.byCommand)}`,
        `by adapter: ${fmtRecord(report.overview.byAdapter)}`,
    ];
    if (Object.keys(report.overview.byHarness).length > 0)
        lines.push(`by harness: ${fmtRecord(report.overview.byHarness)}`);
    lines.push(`by version: ${fmtRecord(report.overview.byToolVersion)}`);
    lines.push("", "== outcomes ==");
    for (const outcome of report.outcomes) {
        lines.push(`${outcome.command} (${outcome.total}): ${fmtRecord(outcome.byOutcome)}  p50=${outcome.latencyMsP50 ?? "-"}ms p95=${outcome.latencyMsP95 ?? "-"}ms`);
        if (Object.keys(outcome.errorKinds).length > 0)
            lines.push(`  errors: ${fmtRecord(outcome.errorKinds)}`);
        if (outcome.search)
            lines.push(`  empty=${pct(outcome.search.emptyRate)} cap_hit=${pct(outcome.search.capHitRate)} stale=${pct(outcome.search.staleRate)} topScoreP50=${outcome.search.topScoreP50 ?? "-"} confidence=${fmtRecord(outcome.search.topHitConfidence)}`);
        if (outcome.index)
            lines.push(`  approve=${pct(outcome.index.approveRate)} duration p50=${outcome.index.durationMsP50 ?? "-"}ms p95=${outcome.index.durationMsP95 ?? "-"}ms`);
    }
    const gate = report.gateFunnel;
    const stale = report.staleRefresh;
    const join = report.searchContextJoin;
    lines.push("", "== activation ==", `not_approved repos: ${gate.notApprovedRepos} (${gate.notApprovedEvents} events) → approved: ${gate.approvedAfterGate} → searched: ${gate.searchedAfterApprove}`, `stale searches: ${stale.staleSearches} → refreshed: ${stale.refreshedWithinWindow} → re-searched: ${stale.reSearchedAfterRefresh}`, "", "== search → context ==", `path contexts: ${join.pathContexts}  query contexts: ${join.queryContexts}`, `joined: ${join.joined} (top-1: ${join.topRankHits}, meanRank: ${join.meanRank ?? "-"})  recovered-miss: ${join.recoveredMisses}  unjoinable: ${join.unjoinable}`);
    if (Object.keys(join.rankHistogram).length > 0)
        lines.push(`rank histogram: ${fmtRecord(join.rankHistogram)}`);
    lines.push("", "Aggregate report only. Raw local telemetry is not included or uploaded.");
    return lines.join("\n");
}
function fmtRecord(record) {
    const entries = Object.entries(record);
    return entries.length === 0 ? "(none)" : entries.map(([key, count]) => `${key}=${count}`).join(" ");
}
function pct(rate) {
    return `${Math.round(rate * 1000) / 10}%`;
}
function ok(out) {
    return { code: 0, out, err: "" };
}
function fail(err, code = 1) {
    return { code, out: "", err };
}
