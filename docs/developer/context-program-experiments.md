# Context programme experiments

Approved programme: [roadmap](../product/roadmap.md#arbeitsprogramm-verlässlicher-nutzen-bei-code-aufgaben).
Frozen [local corpus](context-program-protocol.md): 7/12 complete targets and defined
packages. The post-merge baseline repeats all twelve records unchanged. Agent cases
are prepared independently; their confirmation solutions remain sealed.

## Package 2, candidate 1: retain function hits and local calls

Frozen before implementation or candidate output. Diagnosis: plugin, HTTP/2 and
validator functions already occur within the first five search results, but the
file read plan discards them. HTTP/2 also requires a directly called local function.
This is not an extraction/ranking-weight experiment.

For query context only, keep the first baseline excerpt. From the first five search
results, prioritize at most two non-test, non-noisy function hits with complete
indexed excerpts. Then consider one same-file function directly called by these
seeds: unique top-level JavaScript function declaration, no property dispatch or
shadowed binding, and at least one query term in its body. Rank by call count,
then distinct query-term coverage, then original source position. No transitive
calls, new file search, schema migration or query-specific exceptions.

Fill remaining slots from the original read plan. Suppress contained duplicate
spans. Keep the original excerpt count cap and total source-byte budget; skip
items that do not fit. Record local-call reasons as such, never as imports or
search hits. Path/location requests keep their existing behavior.

Keep only with at least two additional complete-target cases, no formerly complete
target lost, no complete simple control/package lost, exact source spans and every
byte/excerpt cap respected. Then pass the existing full local gates before product
integration. Companion-path presence remains the corpus's limited package measure.
At most one second package-2 candidate may follow a failed result; do not tune this
candidate against its observed losses.
