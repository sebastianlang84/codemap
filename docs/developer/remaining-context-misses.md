# Remaining context misses

Frozen on 2026-09-07 at `49ca2ed`, after the JavaScript definition correction.
No model runs. These are inspected development cases, not a new holdout.

## Plugin dependency check

The original `context lib/plugin-utils.js:64-78 --limit 1` still returns the
complete function but lists no related tests. The existing graph contains the
direct import from `test/internals/plugin.test.js`; filename matching misses it.
With eight excerpts, weaker neighbors crowd out both that test and `lib/errors.js`.
[Baseline](plugin-context-baseline.json).

Candidate: use existing direct test importers in related-test metadata and the
existing test slot of the read plan. Keep the source excerpt and limits unchanged;
preserve filename fallback, scope and truthful relationship reasons.
No new traversal, ranking weights, schemas or prompt text.

Keep only if the fixed real case lists the direct test at every limit, includes it
within four excerpts, retains the complete target, and passes `verify:local`.
The isolated regression also checks mismatched filenames, the filename fallback,
exclusion of unrelated tests, import evidence and subtree boundaries.

Frozen SHA-256:
- `tests/context-importing-tests.test.ts`: `8ce2197ec545092c14df8f466b3d0a276d443bdeefa6b56ab138ff4c1b6e455f`
- `scripts/eval-plugin-context.py`: `cbbe6b4ea99dc31f1ee230cbe82dbe7cbbfb7f347029a194b8ef0203b6ff00fc`

Reproduce with `python3 scripts/eval-plugin-context.py --cli /path/to/dist/cli/bin.js --output /tmp/plugin-context.json`.
The script records failed baselines; inspect `passed`. The regression test fails
before implementation because the directly importing test is absent.

The original task also needs the error catalog, public types and exports. A
function-location request has no task intent for selecting all of those. This
candidate proves test discovery only; it must not be reported as complete task
context or faster agent work.

## Trailers

At Fastify `6d202c6203f33ceb709dbcf6311b2d7152a8a057`, the original query is
`reply trailer handler callback promise first completion chunked framing Content-Length`.
The frozen old CLI selects the caller at line 575 (rank 2); current code selects
`Reply.prototype.trailer` at line 301 (rank 1). Neither includes `sendTrailer`.
An exact `sendTrailer` query ranks line 823 first and returns the complete body,
lines 823–877. Extraction and chunking are correct.

Per-file deduplication removes the lower-scoring function. Removing the partial
symbol bonus alone would select the caller again, not the target. Changing global
weights for this inspected case is unsupported. A separate bounded experiment
would need query-dependent alternatives within one file and a fixed token budget.
