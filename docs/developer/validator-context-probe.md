# Validator context probe

No demonstrated advantage in this retrospective local case. Default CodeMap context
returns substantially more source than informed targeted reads and loses the relevant
test location when passed only its file path. No model calls or runtime changes.

Fixture: Fastify `ff7eff5eec8a820b2c6f79b477e1a784bbf42341`; CodeMap profile
`91cbdc0a2da280a4ea7a3e74c80c6fd4489c695c`. [Machine result](validator-context-probe.json).
Two independent disposable-fixture runs produced identical results; every returned
source excerpt was checked against the fixture.

The question was `custom validator`. Before querying, the probe fixed two targets
already known from the previous trace/source inspection: `validateParam` and the custom
compiler test at `test/schema-special-usage.test.js:692–718`. Required evidence was
replacement handling, errors/async handling, and that existing test's value/error example.
The test checks readiness, not falsy-value replacement; it is context, not a regression oracle.

| Stage | grep / targeted reads | CodeMap defaults |
| --- | --- | --- |
| Discovery | Literal, case-insensitive phrase search includes implementation and selected test among first five paths. | Top five include selected test, but not `lib/validation.js`. |
| Known-target retrieval | Two `sed` calls, 1,580 source bytes; both selected regions present. | Two context calls, 24,400 source bytes; function complete, selected test absent. |

Discovery is separate from retrieval: both retrieval targets were supplied from prior
knowledge. The grep file order is traversal order, not ranking. CodeMap uses its own
query semantics. The targeted-read baseline has known line ranges and is an informed
lower bound, **not an autonomous workflow or a 15-fold agent-efficiency claim**.
Counts exclude search output and CodeMap JSON metadata; they measure source bytes,
not tokens, latency or understanding. No claim about unseen tasks.

The concrete miss: search returns the selected test at lines 695–764, but
`context test/schema-special-usage.test.js --json` returns initial ranges through line 290
and related files. The search location is not preserved by this path-only handoff.
`context validateParam --json` returns the correct function at 118–144, plus seven other
excerpts, including an unrelated route-test function with a similar name. A related
validation helper does show another value/error example; that does not recover the
selected complete test. No alternate query or limit was tuned after seeing the result.

Decision: retain maintenance-only status. Record the lost search location as a failing
development case. Any proposed repair must preserve the trusted hit's region without
adding unrelated context, and pass the existing context/navigation corpus before an
agent experiment is considered. This probe alone does not justify changing ranking.

Reproduce from the repository root (existing local caches, no dependency installation):

```sh
python3 scripts/probe-validator-context.py \
  --repository ~/.cache/codemap/external-holdout-v1/repositories/fastify \
  --cli ~/.cache/codemap/external-holdout-v1/profiles/codemap-0.10.1-91cbdc0a2da2/dist/cli/bin.js \
  --output /tmp/validator-context-probe.json
```

## Location handoff repair

Context now accepts the location printed by search. On the same Fastify fixture,
`context test/schema-special-usage.test.js:695-764 --json` retains lines 695–764;
the plain path still selects 1–80. At the unchanged default limit, returned source
falls from 10,279 to 5,714 bytes. With `--limit 1`, the located chunk is 1,854 bytes.
[Measured outputs](validator-location-result.json). This preserves the search-hit chunk,
not the entire enclosing test (which starts at 692); no agent-savings claim.

Reproduce with the current built CLI against the pinned fixture, using the same
`--repo` and `--state-dir` for these targets:

```sh
codemap context test/schema-special-usage.test.js --json
codemap context test/schema-special-usage.test.js:695-764 --json
codemap context test/schema-special-usage.test.js:695-764 --json --limit 1
```

The original frozen probe remains unchanged. Regression coverage includes a hit beyond
the header, line/range forms, invalid or unavailable locations, scope filtering, literal
colon-number filenames and the CLI. All 285 tests and the search, semantic, context,
navigation and token-injection gates passed. Ranking and agent adoption remain unproven;
no model rerun was started.
