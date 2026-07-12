import { performance } from "node:perf_hooks";
import { codemapContext } from "./context.js";
import { classifyMisses, summarizeMissTaxonomy } from "./eval-miss-taxonomy.js";
import { explainSearchContextReadPlan, mergeSearchContextReadPlan } from "./navigation-read-plan.js";
import { searchCodeMapDebug } from "./search.js";
export function assessNavigationCase(options) {
    const uniqueFilesRead = uniqueStrings(options.filesRead);
    const found = new Set(uniqueFilesRead);
    const expected = uniqueStrings([options.entry, ...options.requiredContext]);
    const missingExpectedFiles = expected.filter((path) => !found.has(path));
    const missingContext = options.requiredContext.filter((path) => !found.has(path));
    const forbiddenRead = (options.forbidden ?? []).filter((path) => found.has(path));
    const entryFound = found.has(options.entry);
    const foundExpectedFiles = expected.length - missingExpectedFiles.length;
    const foundContext = options.requiredContext.length - missingContext.length;
    const contextRecall = rate(foundContext, options.requiredContext.length, options.emptyRecall ?? 0);
    const misses = classifyMisses({
        query: options.query,
        entry: options.entry,
        requiredContext: options.requiredContext,
        missingExpectedFiles,
        forbiddenRead,
        indexStale: options.indexStale ?? false,
        hints: options.missHints,
    });
    return {
        uniqueFilesRead,
        expectedFiles: expected.length,
        foundExpectedFiles,
        expectedRecall: rate(foundExpectedFiles, expected.length, options.emptyRecall ?? 0),
        missingExpectedFiles,
        entryFound,
        requiredContext: options.requiredContext.length,
        foundContext,
        missingContext,
        contextRecall,
        forbiddenRead,
        misses,
        success: entryFound && contextRecall === 1 && forbiddenRead.length === 0,
    };
}
export function summarizeModeMetrics(mode, cases, options = {}) {
    const modeCases = cases.filter((item) => item.mode === mode);
    const latencies = modeCases.map((item) => item.latencyMs);
    const emptyRate = options.emptyRate ?? 0;
    const avgBytes = avg(modeCases.map((item) => item.bytesRead ?? 0));
    return {
        mode,
        tasks: modeCases.length,
        successRate: rate(modeCases.filter((item) => item.success).length, modeCases.length, emptyRate),
        entryHitRate: rate(modeCases.filter((item) => item.entryFound).length, modeCases.length, emptyRate),
        avgExpectedRecall: roundRate(avg(modeCases.map((item) => item.expectedRecall))),
        avgContextRecall: roundRate(avg(modeCases.map((item) => item.contextRecall))),
        avgFilesRead: roundRate(avg(modeCases.map((item) => item.filesRead.length))),
        avgBytesRead: Math.round(avgBytes),
        estTokensRead: estimateTokensFromBytes(avgBytes),
        avgToolCalls: roundRate(avg(modeCases.map((item) => item.toolCalls))),
        forbiddenReadRate: rate(modeCases.filter((item) => item.forbiddenRead.length > 0).length, modeCases.length, emptyRate),
        avgLatencyMs: roundMs(avg(latencies)),
        p95LatencyMs: roundMs(p95(latencies)),
        missTaxonomy: summarizeMissTaxonomy(modeCases.flatMap((item) => item.misses)),
    };
}
export function deltaMetrics(left, right) {
    return {
        successRate: roundRate(left.successRate - right.successRate),
        avgExpectedRecall: roundRate(left.avgExpectedRecall - right.avgExpectedRecall),
        avgContextRecall: roundRate(left.avgContextRecall - right.avgContextRecall),
        avgFilesRead: roundRate(left.avgFilesRead - right.avgFilesRead),
        avgBytesRead: left.avgBytesRead - right.avgBytesRead,
        estTokensRead: left.estTokensRead - right.estTokensRead,
        avgToolCalls: roundRate(left.avgToolCalls - right.avgToolCalls),
    };
}
export function navigateForNavigationEval(options) {
    const { root, stateDir, mode, query, pathPrefix, limit } = options;
    if (mode === "lexical") {
        const hits = options.lexicalSearch(root, query, pathPrefix, limit);
        return {
            filesRead: hits.map((hit) => hit.path),
            searchTop: uniqueSelections(hits.map((hit, index) => ({ path: hit.path, source: "lexical", rank: index + 1, score: hit.score }))),
        };
    }
    const searchDebug = searchCodeMapDebug({ cwd: root, query, pathPrefix, stateDir, limit });
    const searchResults = searchDebug.results;
    const searchPaths = searchResults.map((result) => result.path);
    const searchCandidateBySelectedRank = new Map(searchDebug.candidates.filter((candidate) => candidate.selectedRank !== undefined).map((candidate) => [candidate.selectedRank, candidate]));
    const searchTop = uniqueSelections(searchResults.map((result, index) => {
        const candidate = searchCandidateBySelectedRank.get(index + 1);
        return {
            path: result.path,
            source: "search",
            rank: index + 1,
            score: roundRate(result.score),
            kind: result.kind,
            scoreComponents: candidate ? scoreComponents(candidate) : undefined,
        };
    }));
    const searchCandidates = compactSearchCandidates(searchDebug.candidates, limit);
    if (mode === "codemap_search")
        return { filesRead: searchPaths, searchTop, searchCandidates };
    const contextTarget = searchPaths[0] ?? query;
    const context = codemapContext({ cwd: root, target: contextTarget, pathPrefix, stateDir, limit });
    const readFirst = uniqueSelections(context.readFirst.map((item, index) => ({
        path: item.path,
        source: "context",
        rank: index + 1,
        score: "score" in item ? roundRate(item.score) : undefined,
        kind: item.kind,
        reasons: item.reasons?.map((reason) => reason.kind),
    })));
    const filesRead = mergeSearchContextReadPlan(searchPaths, context.readFirst, limit);
    const readPlanDebug = explainSearchContextReadPlan(searchPaths, context.readFirst, limit);
    return { filesRead, searchTop, searchCandidates, contextTarget, readFirst, readPlanDebug };
}
export function compactSearchCandidates(candidates, limit) {
    return candidates
        .filter((candidate) => candidate.decision !== "non_positive_score")
        .sort((left, right) => (left.selectedRank ?? Number.MAX_SAFE_INTEGER) - (right.selectedRank ?? Number.MAX_SAFE_INTEGER) || right.score - left.score || left.path.localeCompare(right.path))
        .slice(0, Math.max(limit * 4, limit))
        .map((candidate) => ({
        path: candidate.path,
        source: candidate.source,
        rank: candidate.selectedRank,
        score: roundRate(candidate.score),
        decision: candidate.decision,
        kind: candidate.kind,
        scoreComponents: scoreComponents(candidate),
    }));
}
export function scoreComponents(candidate) {
    return {
        retrievalBoost: roundRate(candidate.scoreDiagnostics.retrievalBoost),
        ftsScore: roundRate(candidate.scoreDiagnostics.ftsScore),
        pathScore: roundRate(candidate.scoreDiagnostics.pathScore),
        filenameScore: roundRate(candidate.scoreDiagnostics.filenameScore),
        exactTextScore: roundRate(candidate.scoreDiagnostics.exactTextScore),
        symbolScore: roundRate(candidate.scoreDiagnostics.symbolScore),
        textCoverageScore: roundRate(candidate.scoreDiagnostics.textCoverageScore),
        tokenCoverage: roundRate(candidate.scoreDiagnostics.tokenCoverage),
        matchedTokens: candidate.scoreDiagnostics.matchedTokens,
        codeIntentBoost: roundRate(candidate.scoreDiagnostics.codeIntentBoost),
        roleBoost: roundRate(candidate.scoreDiagnostics.roleBoost),
        testPenalty: roundRate(candidate.scoreDiagnostics.testPenalty),
        docPenalty: roundRate(candidate.scoreDiagnostics.docPenalty),
        noisePenalty: roundRate(candidate.scoreDiagnostics.noisePenalty),
        roles: candidate.scoreDiagnostics.roles,
    };
}
export function stripScoreComponents(items) {
    return items.map(({ scoreComponents: _scoreComponents, ...item }) => item);
}
export function uniqueSelections(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (seen.has(item.path))
            return false;
        seen.add(item.path);
        return true;
    });
}
export function lexicalScore(path, text, terms, options = {}) {
    const haystacks = options.normalize ? [normalizeText(path), normalizeText(text)] : [path.toLowerCase(), text.toLowerCase()];
    let score = 0;
    for (const term of terms) {
        const pathMatches = countOccurrences(haystacks[0], term);
        const textMatches = countOccurrences(haystacks[1], term);
        score += pathMatches * 4 + textMatches;
    }
    return score;
}
export function queryTerms(query, options = {}) {
    const normalized = options.normalize ? normalizeText(query) : query.toLowerCase();
    return uniqueStrings(normalized.split(/[^a-z0-9_]+/).filter((term) => term.length > 1));
}
export function normalizeText(value) {
    return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[-./]+/g, " ");
}
export function countOccurrences(text, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let index = text.indexOf(needle);
    while (index >= 0) {
        count++;
        index = text.indexOf(needle, index + needle.length);
    }
    return count;
}
export function parsePositiveInteger(name, value) {
    if (value === undefined || value.trim() === "")
        throw new Error(`${name} requires a positive integer`);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error(`${name} requires a positive integer`);
    return parsed;
}
export function parseNonNegativeNumber(name, value) {
    if (value === undefined || value.trim() === "")
        throw new Error(`${name} requires a number`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0)
        throw new Error(`${name} requires a non-negative number`);
    return parsed;
}
export function timed(fn) {
    const started = performance.now();
    const result = fn();
    return [performance.now() - started, result];
}
export function rate(numerator, denominator, emptyValue = 0) {
    return denominator === 0 ? emptyValue : roundRate(numerator / denominator);
}
export function avg(values) {
    return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}
export function p95(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}
export function uniqueStrings(values) {
    return [...new Set(values)];
}
// Rough bytes-per-token ratio for English source/text. Deliberately coarse: the eval reports a
// read-cost proxy, not a tokenizer-accurate count, so the estimate stays model-independent and cheap.
export const APPROX_BYTES_PER_TOKEN = 4;
export function estimateTokensFromBytes(bytes) {
    return Math.round(bytes / APPROX_BYTES_PER_TOKEN);
}
export function roundRate(value) {
    return Math.round(value * 1000) / 1000;
}
export function roundMs(value) {
    return Math.round(value * 1000) / 1000;
}
