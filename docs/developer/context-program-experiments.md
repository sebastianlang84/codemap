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

Result: **discard**. [Candidate output](context-program-function-calls-result.json):
targets 7→10 (plugin, HTTP/2, validator), packages 7→8 (validator), no prior losses;
all local budgets and source checks pass. Full verification stops at 314/316 tests:
one retained span loses its inherited relationship reason; query context also
reorders an already-present provider contrary to its existing read-plan test.
No tests or corpus expectations changed. Later gates did not run.
[Exact rejected patch](../../scripts/fixtures/context-program/function-calls-candidate.patch)
applies to `82f079d`; no candidate code is active on main.

## Package 2, candidate 2: restore missing function hits

Frozen before implementation/output. The diagnosis identifies discarded search
hits across files, so this last candidate narrows to that loss and omits local-call
inference. Keep the original baseline items and their reasons in relative order.
From the first five unchanged search hits, consider at most two complete production
function excerpts not already covered by a baseline span. Insert those after the
first baseline item, then fill from the remaining baseline in its original order,
skipping anything exceeding the original source-byte or excerpt cap. Exact duplicate
or contained excerpts are not additions. No new relation type, lexer or ranking weight.

Use the same original 7/12 baseline and unchanged package-2 acceptance criteria.
All existing tests remain unchanged. If this candidate fails, package 2 ends.

Result: **discard**. [Local result](context-program-missing-hits-result.json):
targets 7→9 (plugin, validator), packages 7→8, no previous losses and all budgets
preserved. All 316 tests and the search, semantic, context, agent-navigation and
token gates pass. The [live-repository gate](context-program-missing-hits-gate.json)
fails: two context losses against search, maximum 0.5; allowed one loss and 0.25.
Affected tasks concern MacroLens session restoration and Memory handoff precedence.
Unchanged main rerun passes with seven wins and zero losses; lexical/search control
results are identical across both runs. No expectations were relaxed or candidate
retuned. [Rejected patch](../../scripts/fixtures/context-program/missing-hits-candidate.patch)
applies to `2dcec1c`. Package 2 ends with no product winner.

## Package 3: feasibility of additional file relationships

Inspected existing indexed edges and source on the frozen Fastify snapshots.
The plugin and error tests already import their respective implementations.
Error tests also read literal documentation/type paths through `readFileSync`
and `resolve(__dirname, ...)`; these are real references absent from the graph.
The type resolver also omits `.d.ts` candidates. These are findings, not shipped fixes.

A bounded existing-edge candidate would collect import/reverse-import neighbors
within two steps of original search hits and select one existing query-matched
chunk per additional file. It could recover the validator. Other missing functions
require changing ranges within already-present files or selecting two ranges in
one file; additional-file selection alone does not address them.

The plugin's relevant indexed documentation chunks are 7,008 bytes (contents) and
21,113 bytes (error catalog), each exceeding its entire 6,765-byte source cap.
Other needed chunks add function 442, constructor block 2,334, types 902, export
595 and error tests 3,372 bytes. Adding literal file-read edges does not solve
this budget problem. Choosing a smaller unrelated documentation chunk would game
the corpus's path-presence measure.

Decision: **close on feasibility evidence**, with no package-3 implementation.
Neither proposed file-relationship approach has a credible route to the required
two additional useful complete packages under unchanged chunk/budget constraints.
This does not rule out a separately designed range-selection approach; it avoids
combining another selection change with relationship expansion in this programme.
With no locally accepted product candidate, package 4 is skipped by its frozen gate.
