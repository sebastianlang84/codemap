# Local context development corpus

Twelve historical fixes across Express, Fastify and Flask. Seven function-selection tasks, two multifile tasks and three simple controls. They are development evidence, separate from the new agent tasks and sealed confirmation cases.

The manifest freezes queries, complete base-function ranges, source hashes, reference diff hashes and required companion paths before the first baseline run. Ranges were taken from JavaScript syntax nodes and Python AST nodes and checked against reference changes. Entire functions include their existing documentation. A nested function is complete without requiring its enclosing routing builder. Required tests are existing behavioral surfaces, not every incidental file changed upstream. Fastify 6483 adds a new test, so that nonexistent base path is excluded.

Primary measures: cases with all complete functions; cases with those functions plus source from every required companion path. A path being listed under related tests/docs does not count. Companion-path presence does not certify complete test/type/doc content. This is a bounded retrieval package definition, not proof that an agent has everything needed to solve a task.

Each case allows eight excerpts. Baseline source bytes become that case's candidate cap. Report response bytes separately. Source must match its declared range exactly, using newline-separated lines including the final empty line when present. Preserve reasons and scope in results for manual semantic review; source integrity alone does not prove reason truth. Never revise ground truth because a candidate misses it.

```sh
python3 scripts/eval-context-program.py --cli /absolute/path/to/dist/cli/bin.js --output docs/developer/context-program-baseline.json
python3 scripts/eval-context-program.py --cli /absolute/path/to/candidate/dist/cli/bin.js --baseline docs/developer/context-program-baseline.json --output /tmp/context-program-candidate.json
```

The runner reads cached commits, archives each into a temporary repository, indexes with isolated state, and removes that snapshot afterward. It performs no network setup, dependency install, model call or product mutation. Compare manifest hashes and per-case regressions as well as totals. Keep existing retrieval gates; this corpus adds no independent permission to ship.

Static retrieval ground truth is checked against hashed base source and reference diffs. It is not the agent evaluation's executable oracle. The latter must still fail twice on base and pass twice on reference before model runs. Those executions are not claimed here.

Baseline: 7/12 complete-function cases and 7/12 defined packages; all three simple controls pass. Missing functions occur in plugin dependencies, HTTP/2 payload completion, trailer completion, validator values and Flask IPv6. All returned source spans match. Actual source is roughly 7–133 kB per case; preserving those caps does not establish compact output.

The initial checker treated a terminal newline as absent and falsely rejected whole-file spans. Its newline handling was corrected before recording this baseline; frozen queries, ranges and paths were unchanged.

A second isolated run using the baseline caps reproduced every case record exactly and passed all byte, excerpt and source-integrity checks.
