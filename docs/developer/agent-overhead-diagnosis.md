# Agent overhead diagnosis

2026-09-06. Sources: [12-task pilot](agent-impact-pilot-v1-result.json) and
[four-task pilot](agent-impact-excerpts-v1-result.json). These are observed paired differences,
not causal attribution; models, profiles and tasks differ between pilots.

## Available evidence

Both reports retain outcome, changed paths, provider turns/tool counts, token categories, cost,
agent duration and preparatory index duration. No tool inputs, outputs or per-tool timings remain.
The runner parses buffered stream JSON but did not save it, disables session persistence, and
normally removes workspaces. No retained agent-impact workspace was found under `/tmp`; the
excerpt reports/logs there contain summaries and progress only. The known CodeMap cache contains
profiles and repositories, not run transcripts. `--keep-workdir` alone did not save provider output.
This inventory covers those known locations, not every possible external backup.

Correction: `expectedPathRecall` is computed from **changed paths** in `captureDiff`, not observed
reads. It cannot establish that an agent found or read every relevant file. Bash counts also mix
navigation, edits and test commands; they cannot establish redundant navigation.

## Paired results

Ratios are CodeMap / baseline. Turns are the provider-reported count, not distinct searches.

| Pilot / task | Success baseline / CodeMap | Tokens | Cost | Agent time | Turns baseline / CodeMap |
|---|---|---:|---:|---:|---|
| pilot / express-pr-7377 | pass / pass | 0.703 | 0.549 | 0.642 | 15 / 12 |
| pilot / express-pr-7181 | pass / pass | 1.612 | 1.386 | 1.339 | 27 / 38 |
| pilot / fastify-pr-6965 | pass / pass | 1.288 | 1.210 | 0.496 | 25 / 27 |
| pilot / fastify-pr-6942 | pass / pass | 1.168 | 1.064 | 1.415 | 21 / 30 |
| pilot / fastify-pr-6892 | pass / pass | 0.504 | 0.591 | 1.119 | 27 / 18 |
| pilot / fastify-pr-6889 | pass / pass | 0.496 | 0.547 | 1.085 | 26 / 18 |
| pilot / fastify-pr-6881 | pass / fail | 1.678 | 1.558 | 1.867 | 36 / 43 |
| pilot / fastify-pr-6865 | fail / fail | 0.952 | 0.984 | 0.954 | 18 / 18 |
| pilot / fastify-pr-6846 | pass / pass | 1.135 | 1.184 | 1.268 | 15 / 16 |
| pilot / fastify-pr-6803 | pass / pass | 1.344 | 1.341 | 0.320 | 12 / 14 |
| pilot / flask-pr-6096 | pass / pass | 0.812 | 0.866 | 0.863 | 39 / 35 |
| pilot / flask-pr-5818 | fail / fail | 1.966 | 1.741 | 1.628 | 20 / 28 |
| excerpts / fastify-pr-6719 | fail / fail | 1.527 | 1.280 | 1.988 | 24 / 30 |
| excerpts / fastify-pr-6940 | pass / pass | 1.788 | 1.638 | 1.554 | 19 / 26 |
| excerpts / fastify-pr-6860 | pass / pass | 1.282 | 1.245 | 2.284 | 14 / 20 |
| excerpts / fastify-pr-6845 | pass / pass | 0.873 | 0.759 | 0.293 | 18 / 18 |

Five pilot tasks and one excerpt task were cheaper with CodeMap; the aggregate harm is not a
uniform per-task effect. Navigation difficulty as a predictor remains untested.

In the excerpt pilot, the extra 382,149 tokens comprise 378,131 additional cache-read tokens,
6,898 additional output tokens, 42 additional uncached input tokens and 2,922 fewer cache-write
tokens. Cache reads account for 98.9% of the net increase. Provider cost rose 20.5%, rather than
39.7%; token categories have different prices. Provider turns rose from 75 to 94. Repeated context
processing is consistent with these counts, but larger context versus extra turns versus more
reasoning cannot be separated from these totals.

Preparatory indexing took 5,223 ms across the first pilot and 2,092 ms across the excerpt pilot.
It is outside the recorded agent duration, so it cannot explain that metric's increase. Any
agent-initiated indexing would be inside agent time; command counts alone do not time it.

## Decision and next observation

No trace-backed cause can be selected from these artifacts. Do not change ranking or claim
redundant reads based on them. The existing deterministic retrieval fixes remain independently
verified. The missing-data branch of the [roadmap](../product/roadmap.md#agent-benefit-recovery-plan)
applies: instrument first, retain the old results unchanged, and do not rerun paid failures.

The runner now accepts `--trace-dir` for local raw output capture before provider parsing. Fixtures
cover partial provider output, private file modes, overwrite refusal, worktree/symlink rejection
and a dry-run without writes or agent calls. This is instrumentation evidence, not new agent data.

At the next separately budgeted diagnostic run, compare ordered tool inputs/results for a fresh
paired task and identify work replaced or added. Raw output can reveal repeated reads, unrelated
context and test retries, but the synchronous runner does not provide per-event timestamps or
survive a runner crash with a partial stream. Exact time-to-first-read remains unmeasured.
A diagnostic run is not the eight-task product comparison; step 2 still needs a reproducible cause.

## Fresh trace pair: blocked after control

The [frozen diagnostic manifest](../../scripts/eval-agent-impact-diagnostic.manifest.json) selects
Fastify PR 6879, absent from previous corpora. Both oracle repetitions failed on base and passed
on the reference fix. Freeze commit: `ea5048d`; manifest SHA-256:
`f6acb032959afcf08bd49a48b0437be03af7b91c085693b792dc138cb370fe82`.
The authorized pair cap is $4; the CodeMap profile remains the excerpt pilot's pinned profile.

[Partial evidence](agent-impact-diagnostic-v1-result.json): the baseline completed in 122,233 ms,
with 23 provider turns, 22 tool calls and $0.516341 cost. Its hidden test failed. The CodeMap
attempt failed authentication before any paid usage; there is no valid pair or cost comparison.

The baseline trace locates the runtime implementation in its fifth tool invocation, before the
first edit. It adds a warning and tests, then runs several test commands. The prompt only asks
for an HTTP-method override warning, while the hidden oracle requires `FastifyDeprecation`,
`FSTDEP025` and `overrideExisting`. The agent instead implements `FastifyWarning`/`FSTWRN005`.
This is an under-specified acceptance contract, not evidence that navigation caused the failure.
Keep the frozen prompt/oracle unchanged; limit this pair to diagnostic observations.

Raw traces remain local under `/tmp/codemap-agent-traces/agent-impact-wFZW2X/`.
Baseline trace SHA-256:
`6e162e0b536d9c3e093900b706ac62dc2968c4740964638ccd29653c5c11bff6`.
After providing a separate setup token, resume the same evidence with `--resume` and `--trace-dir`;
only the zero-cost treatment failure is retryable. Preserve the completed paid control.

### Authentication correction

The old runner symlinked personal credentials into each temporary config directory. A
[matching upstream report](https://github.com/anthropics/claude-code/issues/76561) describes atomic
credential replacement detaching that link and leaving stale refresh credentials in the original
location. Dummy-file reproduction confirms the filesystem mechanism; the deleted run directories
prevent proving that it caused this specific outage.

The runner now requires a separate setup token and creates no credential links or copies.
[Setup instructions](agent-impact-eval.md#automation-authentication). Dummy tests cover atomic
replacement/cleanup without touching personal state, conflicting auth sources, private token files,
output redaction and refusal before model setup when the token is absent. A real authenticated
run remains pending owner authorization through `claude setup-token`.

### Setup-token attempt

The supplied private token file passed local format/permission checks. The resumed treatment
used `authentication: setup-token` but returned `401 OAuth access token is invalid` before any
tool calls or paid usage. Total cost remains $0.516341; there is still no valid comparison pair.
The token has a recognizable OAuth prefix, but completeness and server validity are unverified.
No personal credential file was read or linked by the runner. This confirms early failure handling,
not successful live authentication. Replace the supplied token with the complete setup-token
output before retrying. The completed control remains unchanged.
