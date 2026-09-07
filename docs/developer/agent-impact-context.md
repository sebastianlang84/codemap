# Diagnose selected source context

Owner authorized on 2026-09-07. Question: does supplying relevant base source improve
task completion, and does current CodeMap deliver that benefit? This reuses all four
location-comparison tasks for diagnosis. Selection is retrospective; no holdout claim.

Three fresh isolated attempts per task: normal navigation, CodeMap location-first,
and normal navigation with selected source in the initial prompt. Same task, base,
dependency locks and hidden tests. Luna medium in every arm; old high-effort results
are not controls. Twelve attempts, 15 minutes each, sequential rotated arm order,
no outcome-based retries or case replacement. Stop on infrastructure failure.
Subscription usage is recorded in tokens, not inferred dollars or quota consumption.

The context selector inspected task prompts, expected paths and base source/tests only.
Expected paths privilege the selection; this is not automatic retrieval evidence. Freeze exact
ranges and SHA-256 before model runs; verify bytes directly from the base Git snapshot.
At most 16 KiB source per task. Include complete relevant functions and existing
contracts where possible, no patch, new regression tests or solution commentary.
Separate sessions matter: a later task base can already contain another task's fix.
All arms can inspect more source. Only the CodeMap arm gets its CLI. Source selection
effort is excluded from agent time; this is an assisted diagnostic, not a deployable tool.

Primary signal: curated versus normal agent duration, with task success and total
tokens as guardrails. A useful directional signal requires no paired success losses,
at least 15% less aggregate time, token ratio <=1.10, and faster completion on at least
three of four tasks. Report all pairings, outcomes and token categories regardless.
One attempt per arm cannot establish a reliable effect or causal explanation.

Audit retained command traces for navigation/source reads, repeated reads, first edit,
tests/retries, CodeMap usage and supplied-range reuse. Command counts are not time or
token attribution; command events have no per-event wall-clock timing. Do not infer
that supplied text was understood merely because it appeared in the prompt.

Interpretation:
- Curated helps, CodeMap does not: inspect missing/excess source and downstream reads.
- Both help: independent confirmation would be justified, not automatic rollout.
- Neither helps: inspect source sufficiency and reasoning/test work. This does not
  establish an upper bound: manually selected context may still be poor or incomplete.
- Mixed results: retain per-task findings; do not choose another target after results.

No retrieval changes, release, tag or global instruction changes in this experiment.
Internal harness extension needs no version bump. Preserve protocol, manifest and
stable results in Git; raw traces remain private outside the worktree.

Frozen manifest hash: `3e26ff97ef090cfb603b4aba81bcd834c850da990686022aab491e33baba2c38`.
Source bytes: Express 8,221; plugin errors 15,359; HTTP/2 12,657; trailers 14,424.
The same curator saw all four base snapshots; taskwise blinded selection was not used.
Excerpts omit dependencies such as Node HTTP/2 internals and `@fastify/error`.

Reproduce with the existing cache:

```sh
npm run eval:agent-impact -- --manifest scripts/eval-agent-impact-context.manifest.json \
  --cache-dir ~/.cache/codemap/external-holdout-v1 --offline --run-codex \
  --trace-dir /tmp/codemap-context-traces \
  --evidence-output docs/developer/agent-impact-context-result.json
```

Use `--validate-oracles` without run/output flags to check base-fail/reference-pass.
