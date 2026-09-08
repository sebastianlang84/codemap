# End-to-end agent-impact replay

This maintainer-only replay tests whether CodeMap changes completed coding tasks, not only file
retrieval. It runs the same historical bug task with and without a pinned CodeMap build, applies
hidden upstream regression tests afterward, and records success, tool use, tokens, cost, time, and
changed paths.

It is not part of `npm run verify` and does not run in CI: every agent attempt is paid and
non-deterministic.

Latest completed development run: [36 runs with full quality checks](todo-agent-development-result.md).
Both CodeMap arms passed quality and failed the efficiency gate; confirmation remains closed.

## Safety and validity

- The manifest pins full source, fix, and CodeMap commits. Each base must fail the named hidden-test
  assertion twice; the upstream fix must pass twice.
- Source snapshots come from `git archive` and receive a new one-commit repository with no remote or
  upstream history. The hidden tests are added only after the agent patch is captured.
- Agent workspaces, home, Claude configuration, CodeMap state, and call logs live under a temporary
  directory outside the operator home. Personal Claude credentials are never linked or copied.
  A separately supplied setup token authenticates only the isolated Claude process.
- Claude Code runs at medium effort with no MCP servers, no session persistence, a strict tool
  allowlist, and a `PreToolUse` guard against network commands, dependency installs, publication,
  and paths outside the workspace. This is tool-level isolation, not an OS network namespace.
- The control PATH cannot resolve `codemap`. The treatment PATH adds only a wrapper around the
  pinned build. Raw repository content, prompts, stdout, stderr, credentials, and temporary paths
  are excluded from checked-in evidence.
- A provider failure, timeout, or exhausted budget invalidates the pair; it is never scored as a
  treatment loss.

## Automation authentication

Generate a separate token with `claude setup-token`, as described in the
[official authentication guide](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).
The browser authorization must be completed by the account owner. Do not paste the token into
chat, command arguments, repository files or shell history.

Supply it as `CLAUDE_CODE_OAUTH_TOKEN`, or store it outside repositories in a private file and set
`CODEMAP_EVAL_OAUTH_TOKEN_FILE`. Use only one source. Example in your terminal after setup-token:

```bash
install -d -m 700 "$HOME/.agents/secrets"
(
  umask 077
  read -rsp 'Automation token: ' CODEMAP_SETUP_TOKEN
  printf '%s\n' "$CODEMAP_SETUP_TOKEN" > "$HOME/.agents/secrets/codemap-claude-token"
  printf '\n'
)
export CODEMAP_EVAL_OAUTH_TOKEN_FILE="$HOME/.agents/secrets/codemap-claude-token"
```

The runner rejects a missing token before setup or model calls. It strips inherited Anthropic
credentials, endpoint overrides and alternate Claude provider selectors, and supplies the token
only to the Claude child environment. Setup and verification commands receive no Claude auth.
Exact token occurrences are redacted from provider output before parsing or trace storage.
This is not OS containment: tool subprocesses can inherit the Claude environment.

Personal credentials are neither read nor rotated. New attempts record `authentication: setup-token`;
old checkpoint rows remain unchanged. The pending diagnostic pair therefore spans an authentication
change and remains diagnostic evidence, not a controlled product-effect comparison.

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
| Mean changed-path coverage | 0.8972 | 0.8556 |

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

[Overhead diagnosis](agent-overhead-diagnosis.md): existing reports lack tool traces;
`expectedPathRecall` measures changed paths, not read coverage. No causal overhead diagnosis is
possible from aggregate counts alone.

The [agent benefit recovery plan](../product/roadmap.md#agent-benefit-recovery-plan) governs the
next work: diagnose retained traces, test one local change, then decide whether a fresh paid
comparison is justified. No further paid run is authorized by that plan alone.

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

### Frozen excerpt-workflow pilot

Manifest: [`eval-agent-impact-excerpts.manifest.json`](../../scripts/eval-agent-impact-excerpts.manifest.json),
SHA-256 `d3f20148c9f0afab19039bd930e6a6f6352c8bce2097199241bdef0334775fd4`.
Four Fastify fixes are new to both checked-in navigation and agent corpora. Selection uses cached
history order and executable separate regression tests, not CodeMap output. Dependency locks are
pinned. This remains a single-repository development sample.

The existing context-first/no-CodeMap protocol is unchanged. Primary outcome is paired hidden-test
success. Acceptance requires four valid pairs, full adoption, zero contamination/budget exhaustion,
more wins than losses, and token/time ratios at most 1.10. Eight attempts have a $16 maximum budget.
Provider failures remain censored; only zero-cost infrastructure failures may be resumed. The
comparison measures the current workflow, not the isolated causal effect of the excerpt fix.
No untouched holdout is used.

All four oracles passed: each base failed twice and its reference fix passed twice. The initial
attempt produced eight zero-cost authentication failures, preserved in commit `c5e3d62`. After
operator login, the unchanged manifest resumed successfully. All eight attempts used Claude Opus 5
through Claude Code 2.1.261 at medium effort, with Node 22.23.2.

| Metric | No CodeMap | CodeMap |
| --- | ---: | ---: |
| Hidden-test success | 3/4 | 3/4 |
| Total tokens, including cache tokens | 962,194 | 1,344,343 |
| Agent time | 698,354 ms | 757,717 ms |
| Provider cost | $1.6218 | $1.9543 |

| Task | No CodeMap | CodeMap |
| --- | --- | --- |
| Route URL, Fastify 6719 | fail | fail |
| preClose, Fastify 6940 | pass | pass |
| Raw headers, Fastify 6860 | pass | pass |
| Trailer state, Fastify 6845 | pass | pass |

All four pairs were valid: **0 wins, 0 losses, 4 ties**. Context adoption was 4/4, baseline
contamination and budget exhaustion were zero. The harness gate passed, but the predeclared
product criteria failed: there were no extra task successes and the token ratio was 1.3972,
above 1.10. The time ratio was 1.0850. Total cost was $3.5761 against the $16 cap.

The [completed evidence](agent-impact-excerpts-v1-result.json) has stable SHA-256
`9ea18b977ae4c8ef981b76207dd559e1990f129bee7b7405267969d049a70fcf`.
Manifest hash, recomputed summary, gate, model consistency, and all eight attempts were checked.
The runner and prompts were unchanged. The bundled skill was not part of this experiment.

Decision: no positive product-effect signal and no holdout expansion. Keep the independently
verified excerpt correction; this small, single-repository workflow comparison neither isolates
its causal effect nor establishes universal equivalence. Before another paid pilot, identify a
reproducible source of extra navigation work and freeze a distinct development experiment. Do not
repeat these tasks merely to seek a favorable result.

## Optional diagnostic traces

The current runner also saves `run-N-original.patch` privately before hidden tests
replace files, including agent-created tests. Aggregate evidence records its SHA-256,
setup time and independent verifier time separately from agent/index time.
New manifests may supply `publicTestCommand` as argv: it is shown identically to both
arms and must pass twice on the prepared base and reference before hidden tests are applied.
`efficiencyGate.minFasterPairs` prevents one expensive task from deciding the time gate alone.
`agent.maxInfrastructureRetries` caps replacements on resume; superseded attempts remain
in aggregate evidence. Only pre-launch or reported zero-cost infrastructure failures qualify.
Unknown-cost completed/partial attempts and task failures are retained, not rerun. For a
multi-manifest programme, subtract development replacements from the confirmation allowance
before freezing its execution profile so the programme-wide cap cannot reset.

`--validate-sandboxes` adds public-test execution on both base/reference snapshots
in both Codex sandbox arms, without copying a login or invoking a model. It includes
the host oracle checks. Every actual attempt also checks its public command before
launch; `preflightDurationMs` is reported separately and excluded from agent time.
The isolated container mounts a venv's dedicated uv CPython installation read-only
when its interpreter lives outside `/usr`; it does not expose the surrounding host
home or cache. Node-only and system-Python environments retain their existing mounts.

For an already budget-approved run, add `--trace-dir /tmp/codemap-agent-traces`. The runner creates
an isolated directory outside Git worktrees and prints its location. Each run stores raw provider
stdout/stderr, exit status and aggregate durations before parsing, including malformed/timeout
output. Capture is off by default, does not alter prompts or stable evidence, and is ignored by
`--dry-run` and `--validate-oracles`. Resumed attempts get a new directory; existing traces are
never overwritten. A write failure is reported on stderr without making paid work retryable.

Raw traces can contain source and tool output: keep them local and delete them after diagnosis.
Directories/files use private permissions where supported. Codex traces now include monotonic
reception times for command start/completion events and host load before/after the attempt.
Missing events remain unknown; buffering can compress observed durations. These are diagnostic
timings, not exact subprocess measurements or causal attribution. Claude traces retain their
previous format. A runner crash before the provider returns can still lose buffered output.

The next frozen development comparison is [optional CodeMap on eight fresh tasks](agent-impact-optional.md). It adds an optional workflow and a separate efficiency gate; historical manifest behavior remains unchanged.

The unrun Claude proposal is superseded by [Codex with gpt-5.6-luna](agent-impact-luna.md): same tasks, token-primary gate, no invented USD accounting.

[Luna-high v2 result](agent-impact-luna-result.md): 8/8 success in both arms, zero optional CodeMap use, token/time efficiency gate failed.
