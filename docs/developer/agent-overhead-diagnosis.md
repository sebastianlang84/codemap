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

The fresh pair below supplies ordered tool inputs/results. The synchronous runner provides no
per-event timestamps and cannot retain a partial stream after a runner crash. Exact time to the
first source read remains unmeasured. This is not the eight-task product comparison.

## Completed fresh trace pair

The [frozen manifest](../../scripts/eval-agent-impact-diagnostic.manifest.json) selects Fastify
PR 6879, absent from previous corpora. Base failed and reference passed twice. Freeze commit:
`ea5048d`; manifest SHA-256:
`f6acb032959afcf08bd49a48b0437be03af7b91c085693b792dc138cb370fe82`.
The CodeMap profile remains pinned to the excerpt pilot. No further paid run was needed after
completing the previously authorized pair.

[Completed evidence](agent-impact-diagnostic-v1-result.json), one valid pair:

Stable SHA-256: `6808383df15543a90358735f597b74d61d7aea19b76005cbd796cc8f7792c90a`.

| Metric | Baseline | CodeMap | Change |
|---|---:|---:|---:|
| Hidden-test success | fail | fail | tie |
| Total tokens including caches | 291,141 | 427,601 | +46.9% |
| Provider cost | $0.516341 | $0.612544 | +18.6% |
| Agent duration | 122,233 ms | 105,472 ms | −13.7% |
| Provider turns / tool calls | 23 / 22 | 28 / 27 | +5 / +5 |

Total cost: $1.128885 against the authorized $4 cap. Preparatory CodeMap indexing took 489 ms,
outside agent duration. Of 136,460 additional tokens, 133,936 were cache reads, 2,239 cache
creation, 271 output and 14 uncached input. Token totals alone do not identify their cause.

### Ordered trace observations

Tool positions below are one-based. Calls containing reads and tests are classified as tests;
these counts describe commands, not exclusive time or token attribution.

| Primary purpose | Baseline calls | CodeMap calls |
|---|---|---|
| Environment/tool discovery | 1 | 1–2 |
| Navigation/source reads | 2–7, 11, 17 | 3–10, 25 |
| Edits, including scripted writes | 8–10, 12–16, 18 | 11–19, 26 |
| Tests/lint, including retries | 19–22 | 20–24, 27 |

- CodeMap call 3 runs `codemap context "http method override warning"`. Its entire output is
  eight path/range entries and a related-document hint, with **no source text**. `head -60`
  did not truncate that nine-line result. Call 4 separately reads `lib/warnings.js`.
- The same two lexical discovery patterns occur in both arms: method-override terminology,
  then `addHttpMethod`. CodeMap therefore did not replace those searches in this observed run.
  Baseline reads the runtime implementation in call 5; treatment does so in call 7. Their first
  edits are calls 8 and 11. Exact elapsed time to those reads is unavailable.
- Both arms use an unsupported test-directory argument, repeat it to inspect failure output,
  then switch to a working glob. Both retry documentation writes with Edit after scripted
  replacements. These retries are not specific to CodeMap.
- Treatment performs more test/lint calls but omits baseline's broad `test/*.test.js` run.
  Verification scope differs, so lower aggregate duration cannot establish faster navigation.

Both implementations choose `FastifyWarning`/`FSTWRN005`; the hidden oracle requires
`FastifyDeprecation`/`FSTDEP025` and `overrideExisting`, absent from the terse prompt. Treatment
also limits warnings to body-support changes. Keep the frozen oracle unchanged: this is an
under-specified acceptance contract and a diagnostic pair, not a clean task-success comparison.
Authentication changed between arms (personal credentials versus setup token), another limitation.

Raw traces remain local:

- Baseline: `/tmp/codemap-agent-traces/agent-impact-wFZW2X/run-1.json`, SHA-256
  `6e162e0b536d9c3e093900b706ac62dc2968c4740964638ccd29653c5c11bff6`.
- Treatment: `/tmp/codemap-agent-traces/agent-impact-NHMfTY/run-2.json`, SHA-256
  `7622ee69a2ad2cc0805346250ab79d8f73fbeae35692ff8dc067cb843a362aff`.

### Local delivery experiment

Hypothesis: requesting existing JSON context could supply the warning source and remove the next
file read. Fixed input: the same Fastify base, pinned CodeMap profile and exact call-3 query.
Only output format changes; no model calls. Acceptance: replace that read with complete source
while retaining the navigation evidence and without adding unrelated source output.

The text result is 491 bytes and contains no code. JSON is 82,960 bytes in this local reproduction;
55 KB of source text comes from two large documentation chunks. It contains the warning source,
but `fastify.js` still points to lines 1–80 instead of the `addHttpMethod` implementation. The
blanket JSON candidate fails the output guardrail. Discard it as a workflow change; this local
check cannot establish whether an agent would actually omit a read.

A separate CLI correctness defect appeared: the pinned binary repeatedly returned only 65,536
bytes through a pipe, invalid JSON, while file redirection retained the complete JSON. The CLI
called `process.exit` immediately after writing. Setting `process.exitCode` lets pending output
drain. A slow-consumer executable regression fails before and passes after this one-line fix;
the original Fastify reproduction then parses successfully. This was not the cause of the
observed agent overhead: that run used text output.

Decision: keep the independently verified pipe fix; do not expand the paid pilot. No workflow
candidate has passed the local gate. Any future compact-source experiment must first retain
required code, bound unrelated output and demonstrate removed reads locally. The historical
pilots still cannot be causally explained without their missing traces.

### Authentication resolution

Earlier personal-auth and setup-token attempts failed before paid usage. The OpenBao retry
confirmed delivery of the supplied value but also received HTTP 401. The local token was later
found to contain three identical concatenated copies. After authorized deduplication, the pending
treatment authenticated and completed. No secret values are retained here. This run used the local
file directly; it does not verify that the separately stored OpenBao value has been corrected.

The runner no longer symlinks personal credentials into disposable configs. A
[matching upstream report](https://github.com/anthropics/claude-code/issues/76561) describes atomic
replacement detaching such links; dummy-file reproduction confirms the mechanism, not the cause
of the earlier personal-login outage. [Automation setup](agent-impact-eval.md#automation-authentication).

## Compact-source experiment

Frozen before candidate implementation: [manifest](../../scripts/eval-context-delivery.manifest.json),
baseline `aabb399`. One rendering change only: keep existing context order and warnings, replace
metadata-only rows with complete code chunks that fit an 8 KiB UTF-8 output cap. Keep oversized
chunks and documentation as path/range omission notices. Do not change ranking, queries, index,
chunk selection, skill, or runtime defaults. This is an internal local prototype, not a CLI flag.

Five positive cases require exact source ranges: the observed Fastify task, a trusted warning
path, a trusted Fastify symbol, and JavaScript/Python symbols after long headers. Two controls
require honest omission for oversized code and an empty result for an absent symbol. Fastify is
pinned; synthetic files and required ranges are stored in the manifest. These are development
cases, not untouched holdout evidence.

Keep only if all five cases deliver every required source line, each output stays within 8 KiB
with at most 2 KiB of unrelated source, and both controls pass. Compare metadata output, full JSON
and the candidate on identical packages. Source availability is a proxy for an avoidable file
read, not proof that an agent omits it. Any failed criterion ends this attempt without another
paid run or tuning these cases. No new agent budget is authorized.
