export function emptySearchQualityMetrics() {
    return { cases: 0, top1Accuracy: 0, recallAt5: 0, expectedCoverageAt5: 0, mrrAt5: 0, avgLatencyMs: 0, p95LatencyMs: 0, misses: [], partialMisses: [], excludedHits: [] };
}
export function scoreSearchQualityCases(cases, search, now = () => performance.now()) {
    if (cases.length === 0)
        return emptySearchQualityMetrics();
    const emptyExpectedCase = cases.find((item) => item.expectedPaths.length === 0);
    if (emptyExpectedCase)
        throw new Error(`Search quality case has no expected paths: ${emptyExpectedCase.query}`);
    let top1 = 0;
    let recall5 = 0;
    let expectedCoverage5 = 0;
    let reciprocalRankSum = 0;
    const latencies = [];
    const misses = [];
    const partialMisses = [];
    const excludedHits = [];
    for (const item of cases) {
        const start = now();
        const paths = [...new Set(search(item.query))].slice(0, 5);
        latencies.push(now() - start);
        const matchedExpectedPaths = item.expectedPaths.filter((path) => paths.includes(path));
        const missingExpectedPaths = item.expectedPaths.filter((path) => !paths.includes(path));
        expectedCoverage5 += matchedExpectedPaths.length / item.expectedPaths.length;
        const rank = paths.findIndex((path) => item.expectedPaths.includes(path));
        if (rank === 0)
            top1++;
        if (rank >= 0) {
            recall5++;
            reciprocalRankSum += 1 / (rank + 1);
        }
        else {
            misses.push({ query: item.query, expectedPaths: item.expectedPaths, actual: paths });
        }
        if (missingExpectedPaths.length > 0) {
            partialMisses.push({ query: item.query, expectedPaths: item.expectedPaths, missingExpectedPaths, actual: paths });
        }
        const excludedPathHits = (item.excludedPaths ?? []).filter((path) => paths.includes(path));
        if (excludedPathHits.length > 0)
            excludedHits.push({ query: item.query, excludedPaths: excludedPathHits, actual: paths });
    }
    latencies.sort((a, b) => a - b);
    return {
        cases: cases.length,
        top1Accuracy: round(top1 / cases.length),
        recallAt5: round(recall5 / cases.length),
        expectedCoverageAt5: round(expectedCoverage5 / cases.length),
        mrrAt5: round(reciprocalRankSum / cases.length),
        avgLatencyMs: round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
        p95LatencyMs: round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0),
        misses,
        partialMisses,
        excludedHits,
    };
}
export function evaluateSearchQualityGate(metrics, thresholds, label = "search") {
    if (metrics.cases === 0) {
        return thresholds.requireCases === true
            ? { passed: false, issues: [{ label, metric: "cases", expected: "> 0", actual: 0 }] }
            : { passed: true, issues: [] };
    }
    const issues = [];
    addMinIssue(issues, label, "top1Accuracy", metrics.top1Accuracy, thresholds.minTop1Accuracy);
    addMinIssue(issues, label, "recallAt5", metrics.recallAt5, thresholds.minRecallAt5);
    addMinIssue(issues, label, "expectedCoverageAt5", metrics.expectedCoverageAt5, thresholds.minExpectedCoverageAt5);
    addMinIssue(issues, label, "mrrAt5", metrics.mrrAt5, thresholds.minMrrAt5);
    if (thresholds.maxP95LatencyMs !== undefined && metrics.p95LatencyMs > thresholds.maxP95LatencyMs) {
        issues.push({ label, metric: "p95LatencyMs", expected: `<= ${thresholds.maxP95LatencyMs}`, actual: metrics.p95LatencyMs });
    }
    if (thresholds.failOnMisses === true && metrics.misses.length > 0) {
        issues.push({ label, metric: "misses", expected: "0", actual: metrics.misses.length });
    }
    if (thresholds.failOnPartialMisses === true && metrics.partialMisses.length > 0) {
        issues.push({ label, metric: "partialMisses", expected: "0", actual: metrics.partialMisses.length });
    }
    const excludedHitCount = metrics.excludedHits?.length ?? 0;
    if (thresholds.failOnExcludedHits === true && excludedHitCount > 0) {
        issues.push({ label, metric: "excludedHits", expected: "0", actual: excludedHitCount });
    }
    return { passed: issues.length === 0, issues };
}
function addMinIssue(issues, label, metric, actual, minimum) {
    if (minimum !== undefined && actual < minimum)
        issues.push({ label, metric, expected: `>= ${minimum}`, actual });
}
function round(value) {
    return Math.round(value * 1000) / 1000;
}
