import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, repoKey, resolveStateDir } from "../core/repo.js";
import { USAGE_LOG_NAME } from "../core/state-gc.js";
import { anonymizeUsageReport, buildUsageReport, parseUsageLines } from "./usage-report.js";
/** Read both local log generations and return only the aggregate, shareable report projection. */
export function readAnonymizedUsageReport(options = {}) {
    const stateDir = resolveStateDir(options.stateDir);
    const lines = [];
    for (const name of [`${USAGE_LOG_NAME}.1`, USAGE_LOG_NAME]) {
        const path = join(stateDir, name);
        if (!existsSync(path))
            continue;
        try {
            lines.push(...readFileSync(path, "utf8").split("\n"));
        }
        catch {
            throw new Error("Unable to read the local usage telemetry log");
        }
    }
    const parsed = parseUsageLines(lines);
    const events = filterUsageEvents(parsed.events, options);
    return anonymizeUsageReport(buildUsageReport(events, {
        malformedLines: parsed.malformedLines,
        joinWindowMs: options.joinWindowMs,
    }));
}
function filterUsageEvents(events, options) {
    let filtered = events;
    if (options.repo) {
        const { canonicalRoot, key } = resolveRepoFilter(options.repo);
        filtered = filtered.filter((event) => event.repo_key === key ||
            (canonicalRoot !== undefined && event.repo_root === canonicalRoot));
    }
    if (options.sinceMs !== undefined) {
        filtered = filtered.filter((event) => Date.parse(event.ts) >= options.sinceMs);
    }
    return filtered;
}
function resolveRepoFilter(value) {
    if (/^[a-f0-9]{24}$/.test(value))
        return { key: value };
    try {
        const canonicalRoot = findRepoRoot(value);
        return { canonicalRoot, key: repoKey(canonicalRoot) };
    }
    catch {
        throw new Error("--repo must be an existing Git repository or a 24-character repository key");
    }
}
