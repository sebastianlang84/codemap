// Small shared string/path helpers. These were previously copy-pasted verbatim across ranking,
// search-pipeline, context-builder, relationships, index-health, query-plan and ignore; keep the
// single definition here so the escaping and locality rules cannot drift between call sites.
/** Escape a value for use inside a SQL `LIKE ? escape '\'` pattern. */
export function escapeLike(value) {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
/** Escape a value so it can be embedded literally inside a `RegExp`. */
export function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Word-boundary matcher for a query term (non-alphanumeric boundaries, Unicode-aware). Compiled
// patterns are memoized: the pattern for a term is constant, and this runs per candidate × term in the
// ranking hot path — so a search reuses one RegExp per term instead of recompiling for every candidate,
// and the long-lived MCP process reuses them across searches. The `.test()` calls are stateless (no
// `g`/`y` flag → no `lastIndex`), so sharing one object is safe. Bounded to cap growth in a long run.
const termPatternCache = new Map();
const TERM_PATTERN_CACHE_MAX = 4096;
export function termBoundaryPattern(term) {
    let pattern = termPatternCache.get(term);
    if (!pattern) {
        if (termPatternCache.size >= TERM_PATTERN_CACHE_MAX)
            termPatternCache.clear();
        pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u");
        termPatternCache.set(term, pattern);
    }
    return pattern;
}
/** De-duplicate a list of strings, preserving first-seen order. */
export function uniqueStrings(values) {
    return [...new Set(values)];
}
/**
 * Score how "local" `path` is relative to `base`: more shared leading directory segments score
 * higher, an exact same-directory match gets a bonus, and differing directory depth is penalised.
 * Used to rank related/read-first paths by proximity to the target file.
 */
export function localityScore(base, path) {
    const baseDir = base.split("/").slice(0, -1);
    const pathDir = path.split("/").slice(0, -1);
    let shared = 0;
    while (shared < baseDir.length && shared < pathDir.length && baseDir[shared] === pathDir[shared])
        shared++;
    const sameDir = baseDir.length === pathDir.length && shared === baseDir.length;
    const depthPenalty = Math.abs(baseDir.length - pathDir.length);
    return shared * 10 + (sameDir ? 5 : 0) - depthPenalty;
}
