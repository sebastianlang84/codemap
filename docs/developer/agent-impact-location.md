# Location-first agent comparison

User-authorized development comparison: four unused tasks, eight attempts, Codex
`gpt-5.6-luna` with `high` effort. No automatic model retries or outcome-based task
replacement. Selection and oracle validation precede model calls. This tests an
instructed navigation workflow, not optional adoption or the isolated effect of a fix.

Treatment starts navigation with search, reads a trusted `path:start-end` hit using
`--json --limit 1`, and may use ordinary tools when results are weak. Baseline uses
ordinary tools. Host skills remain disabled in both arms; the treatment receives the
fixed short workflow instruction, not the full bundled skill. Skill-loader behavior
is outside this comparison.

Both arms receive working ripgrep and the same local HTTP socket permissions.
Before each model call, the actual Codex sandbox checks login-shell `rg`, Node, npm,
and a localhost server/client. Treatment also checks CodeMap status. These checks
run before the agent timer and use a separate call log so they cannot count as adoption.
The preflight has regression tests for both arms and filesystem isolation.

Environment at protocol preparation: Codex CLI `0.153.4`; ripgrep `15.2.0`, SHA-256
`e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849`.
Existing account login is copied privately per attempt; no Claude calls or USD estimates.
The CLI does not expose the actual response model; requested model is pinned and observed
rerouting invalidates an attempt. Provider failures stop the series and preserve evidence.

Continue only with all four valid pairs, zero paired losses, at least 15% fewer total
tokens and no more than 10% additional agent time. At least three treatment runs must use both search and context; adoption is reported
separately; all assigned pairs count, including non-use. A small descriptive result
cannot establish general benefit. Failure leaves CodeMap in maintenance-only status;
a pass supports a further decision, not an automatic larger experiment.

Full test output handling stays identical between arms. Token totals include cached input;
source-output size is not used as a substitute for agent tokens. Raw traces remain outside
Git with a hash inventory; the stable result and interpretation belong here in the repo.

## Frozen cases

[Manifest](../../scripts/eval-agent-impact-location.manifest.json), pinned CodeMap profile
`22c9fe0e21782c5ed0bee0e607a7e95a5f24d11b`. Final selection precedes agent calls:

| Task | Behavior |
| --- | --- |
| Express 6285 | Send Uint8Array bytes with the expected text content type. |
| Fastify 6774 | Missing plugin dependency produces the documented Fastify error and matching public types. |
| Fastify 6746 | Large HTTP/2 replies finish; cancellation leaves later streams usable. |
| Fastify 6714 | Mixed callback/promise trailers honor the first completion. |

Selection used cached first-parent main histories and excluded every previous agent-impact
and external-navigation case plus local probes. Express had only one eligible fresh case;
Fastify supplies the other three. Dependency-only, refactor-only, deletion-only and changes
without separate behavioral regression tests were excluded. Specific remaining exclusions:
Express 6091/6196/6071/5569 (dependency/refactor), 5933 (only deleted tests), 5672
(added tests do not cover changed warning behavior); Fastify 6973/6799 (duplicate behaviors),
6837 (no separate regression test), 6830 (mixed refactor/internal APIs). Fastify 6458 is an
unused reserve, not an automatic replacement. During pre-model selection, 6774 was restored
to its correct descending position ahead of 6746; no model output influenced selection.

Express 6285 and Fastify 6746/6714 use newly frozen exact-base locks. Fastify 6774 reuses
the existing 6803 lock after dependency/devDependency equality was checked. Package files
and lock files are forbidden agent changes. Prompts describe all tested behaviors, including
6774's error-catalog/type consistency, without source locations.

```sh
node --experimental-strip-types scripts/eval-agent-impact.ts \
  --manifest scripts/eval-agent-impact-location.manifest.json \
  --offline --cache-dir ~/.cache/codemap/external-holdout-v1 \
  --run-codex --quality-gate \
  --trace-dir /tmp/codemap-agent-traces/location-v1 \
  --evidence-output docs/developer/agent-impact-location-result.json
```

The runner validates all four oracles twice before the first model call and checkpoints
each attempt. Do not use `--resume` to repeat completed model attempts.

Launch correction before any model call: the trace guard rejected `~/.agents/state`
because its parent is a Git worktree. Raw capture uses `/tmp`; verified private copies
are archived under the ignored agent state directory after completion.
