# End-to-end agent-impact replay

This maintainer-only replay tests whether CodeMap changes completed coding tasks, not only file
retrieval. It runs the same historical bug task with and without a pinned CodeMap build, applies
hidden upstream regression tests afterward, and records success, tool use, tokens, cost, time, and
changed paths.

It is not part of `npm run verify` and does not run in CI: every agent attempt is paid and
non-deterministic.

## Safety and validity

- The manifest pins full source, fix, and CodeMap commits. Each base must fail the named hidden-test
  assertion twice; the upstream fix must pass twice.
- Source snapshots come from `git archive` and receive a new one-commit repository with no remote or
  upstream history. The hidden tests are added only after the agent patch is captured.
- Agent workspaces, home, Claude configuration, CodeMap state, and call logs live under a temporary
  directory outside the operator home. Only Claude credentials are linked into the isolated config.
- Claude Code runs at medium effort with no MCP servers, no session persistence, a strict tool
  allowlist, and a `PreToolUse` guard against network commands, dependency installs, publication,
  and paths outside the workspace. This is tool-level isolation, not an OS network namespace.
- The control PATH cannot resolve `codemap`. The treatment PATH adds only a wrapper around the
  pinned build. Raw repository content, prompts, stdout, stderr, credentials, and temporary paths
  are excluded from checked-in evidence.
- A provider failure, timeout, or exhausted budget invalidates the pair; it is never scored as a
  treatment loss.

## Commands

```bash
npm run eval:agent-impact -- --dry-run
npm run eval:agent-impact -- --validate-oracles
npm run eval:agent-impact -- \
  --approve-budget-usd 8 \
  --quality-gate \
  --evidence-output docs/developer/agent-impact-smoke-v3-result.json
```

Use `--offline` only with an existing `--cache-dir`. A paid run refuses to start unless the approved
amount covers the manifest's worst case. `--task` and `--mode` are diagnostic subsets and cannot
write aggregate evidence. Full paired runs checkpoint atomically after every attempt. `--resume`
keeps completed paid attempts from a matching manifest and retries only infrastructure failures that
recorded zero provider cost. Unless `--keep-workdir` is set, each oracle and attempt workspace is
removed immediately so large dependency trees do not accumulate in the temporary filesystem.

## Smoke results

Both runs used Claude Code 2.1.245, Claude Opus 5, medium effort, CodeMap 0.10.0, and the same two
Express/Fastify tasks. This is a harness smoke over previously inspected cases, not a product-effect
holdout.

| Frozen run | Treatment workflow | Hidden-test success | Workflow adoption | Treatment / baseline tokens | Treatment / baseline agent time | Cost | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| v2 | `search → context` | 2/2 vs 2/2 | 0/2 | 1.320× | 1.122× | $3.1519 total | failed |
| v3 | fused `context <query>` | 2/2 vs 2/2 | 2/2 | 1.140× | 1.662× | $2.9160 total | passed |

V2 failed its predeclared adoption gate because both treatment agents ran `search`, but neither ran
`context`. The v2 manifest remains frozen at SHA-256
`ad98383dff18f1bdc604a0f2c77d45564c95439436fcac1944ce563fae6d3310`; its evidence is
[`agent-impact-smoke-v2-result.json`](agent-impact-smoke-v2-result.json), SHA-256
`f7743bbbcc1d2b15f0f0b8de1e0342827f66dc0d0e22c764f287da9ed3748e70`.

V3 changed one lever: the treatment started with CodeMap's already-shipped fused context query. Its
manifest SHA-256 is `1f73e3ec889c3b141b771af14111162cc4d31e435946ba1fd8e88d2306160680`;
the evidence is [`agent-impact-smoke-v3-result.json`](agent-impact-smoke-v3-result.json), SHA-256
`e75d8bfd1180e23bfc57056a99cd071be00608220e386424e5a7ee8acf098109`. Both context-first agents
used CodeMap and all four patches passed. Treatment cost was $1.5719 versus $1.3441 for control
(1.169×). The sample is too small and stochastic for a quality, latency, or cost claim.

## Development pilot result

The frozen 12-task pilot ran 24 Claude Opus 5 attempts at medium effort across Express, Fastify, and
Flask. Ten tasks were new agent replays; two were smoke calibration cases. Every base failed its
named hidden assertion twice and every upstream reference fix passed twice. Eight npm dependency
trees were injected from checked-in SHA-256-pinned locks; both Flask tasks used their upstream
`uv.lock`.

| Metric | Baseline | CodeMap 0.10.0 context-first |
| --- | ---: | ---: |
| Hidden-test success | 10/12 | 9/12 |
| Provider cost | $6.6323 | $7.4065 |
| Total tokens | 4,540,405 | 5,285,056 |
| Agent time | 1,974,352 ms | 2,223,698 ms |
| Mean expected-path recall | 0.8972 | 0.8556 |

Paired outcome: **0 wins, 1 loss, 11 ties** (`p=1.0`). Treatment adoption was 12/12, baseline
contamination 0, budget exhaustion 0, and the harness gate passed. CodeMap used 1.164× the tokens,
1.126× the agent time, and 1.117× the cost. Total spend was $14.0389 against a $48 worst-case cap.
Both arms failed `fastify-pr-6865` and `flask-pr-5818`; only CodeMap failed `fastify-pr-6881`.

The manifest SHA-256 is
`727db942501d0e0308aaafd01dbc0a1cdcfa214ad48f74ef9d10cd0d02f3a16a`; the evidence is
[`agent-impact-pilot-v1-result.json`](agent-impact-pilot-v1-result.json), SHA-256
`8f9d2a7899c4fe997f7282a415acf83a9a137d8df9984c72d6508464dfcdf147`.

### Kept retrieval follow-up

The losing Fastify task exposed a concrete navigation miss. On its frozen base snapshot, the exact
bug-report query omitted `lib/hooks.js` from the eight-file CodeMap read plan and anchored on an
unrelated request-error test. One post-pilot lever now treats a simple singular/plural match between
a query term and a code module basename as strong filename evidence. The same query then includes
`lib/hooks.js` second in the read plan. A red-to-green synthetic regression pins the behavior.

The fixed search-quality suites were unchanged, the fixture agent-navigation context remained 1.0
success/recall with no forbidden reads, and the 24-case local real-repo gate remained 7 wins, 0
losses, and 17 ties. This proves the retrieval correction without a measured regression. The
coding-task confirmation below tests the narrower product-effect hypothesis.

### Module-name confirmation

Three independent paired replays repeated the sole pilot treatment loss against the released
CodeMap 0.10.1 profile. Task, oracle, order, profile, budget, and the decision rule were frozen
before execution. The hypothesis required three valid pairs, full treatment adoption, no
contamination or budget exhaustion, treatment success at least equal to baseline, and more paired
wins than losses.

The gate failed. Only two pairs were valid, with **1 win and 1 loss**; both arms succeeded once and
failed once. Treatment adoption was 2/2 in the valid pairs, baseline contamination and budget
exhaustion were zero, and CodeMap used 1.052× the tokens and 0.975× the agent time. Total spend was
$4.3134 against a $12 cap. The third CodeMap attempt ended in a provider API error after $0.7084 of
usage; its baseline also ended in a zero-cost API error. The frozen protocol permits retry only for
zero-cost failures, so the pair remains invalid and was not rerun.

The manifest SHA-256 is
`b5dd1a08c1b607e1855c215dec6de00f248df602ec90ba5ad376f8b316f656a9`; the evidence is
[`agent-impact-confirmation-v1-result.json`](agent-impact-confirmation-v1-result.json), stable
SHA-256 `92c4f80538189657298e4f44c21ff6c8efd4b8d73cc4953a47a5db724d33dbff`.

This result does not confirm a coding-task benefit from the module-name correction. It also does
not justify removing the deterministic, regression-tested retrieval fix: the bounded agent replay
is inconclusive about causal effect, while the retrieval behavior remains directly verified.

## Interpretation and next gate

The replay and its isolation work. The first workflow exposed a real search-to-context drop-off;
the simpler workflow removed that drop-off in the repeat smoke. Neither run showed a task-success
gain, and v3 used more tokens, time, and money. Therefore this evidence does not justify a ranking
change or a user-facing workflow change.

The pilot rejects a product-effect claim for the 0.10.0 context-first workflow: it produced no task
win, one task loss, and higher resource use. The 0.10.1 module-name confirmation did not clear its
predeclared gate: its two valid pairs split 1–1 and its third pair was invalid. Do not rerun the same
case to seek a favorable score, and do not spend a fresh approximately 40-task holdout on this
profile. A new development experiment needs a different, reproducible agent-task miss and one
corresponding lever. Only a positive signal on fresh development cases justifies the untouched
holdout; its primary outcome remains paired hidden-test success, with tokens, cost, time, and
CodeMap use as secondary outcomes.

## Matched-chunk development follow-up

On 2026-09-06, a local symbol query found `buildSearchContextReadPlan` at line 85,
but query-form context replaced it with the file header at lines 1–53. The correction
selects the indexed chunk containing the search hit without changing the file read plan.
New JavaScript/Python excerpt gates fail on the previous implementation and pass with the fix;
a separate regression covers a function after a 90-line header and a matched neighbor.
This establishes excerpt correctness, not an end-to-end task or token-saving benefit.
Validation: all 261 tests and `verify:local` gates passed; local navigation remained
7 wins, 0 losses, 17 ties. The original query now returns lines 85–143.
