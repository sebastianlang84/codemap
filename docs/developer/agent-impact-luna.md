# Optional CodeMap with Codex Luna

Replaces the unrun Claude proposal at the user's request. Both arms use Codex CLI,
`gpt-5.6-luna`, medium effort and the existing ChatGPT login. No Claude token or API-key
billing. The [manifest](../../scripts/eval-agent-impact-luna.manifest.json) preserves all
eight tasks, dependency locks and the pinned CodeMap candidate from the previous plan.
Their [oracle validation](agent-impact-optional-readiness.json) remains applicable;
tests enforce identical task definitions. Previous Claude results remain separate.

Freeze before model calls: 16 attempts, 15 minutes per attempt, no automatic retries after
provider work or unknown usage. Primary target: total-token ratio <= 0.85, zero paired
success losses, agent-time ratio <= 1.10. All eight pairs must be valid, traces complete,
with no control-arm CodeMap use. Optional non-use counts as assigned. These are development
continuation thresholds, not statistical significance or evidence of saved subscription quota.
Report every pair and per-repository results before a keep/discard decision.

Codex JSONL reports tokens, not USD. Cost and USD limits are `null`, never inferred as zero.
Input totals already include cache reads/writes; output totals include reasoning. Record
those components without double-counting. Requested model is pinned; exec does not report
the actual response model, so evidence says `unknown`/`requested-only`. Observed rerouting
invalidates a run. This is a weaker model-verification boundary than the Claude report.

Each attempt uses an isolated filesystem containing system runtime, its workspace, the
pinned CodeMap profile and the Codex executable. Personal instructions, skills and config
are suppressed. A private disposable login copy permits authentication without modifying
the user's original credentials. Codex shell execution uses workspace-write with network
disabled; the model process retains network access. Traces stay outside Git.

Local preparation does not call a model:

```sh
npm run eval:agent-impact -- --manifest scripts/eval-agent-impact-luna.manifest.json --dry-run
node --experimental-strip-types --test tests/agent-impact-codex.test.ts tests/agent-impact.test.ts
```

Run the fixed comparison:

```sh
npm run eval:agent-impact -- \
  --manifest scripts/eval-agent-impact-luna.manifest.json \
  --cache-dir /home/wasti/.cache/codemap/external-holdout-v1 --offline \
  --run-codex --quality-gate --trace-dir /tmp/codemap-agent-traces \
  --evidence-output docs/developer/agent-impact-luna-result.json
```

`--run-codex` is an execution switch, not a dollar-budget approval. Stop after infrastructure
failure and retain partial evidence; no model substitutions or automatic second comparison.
A passing development result permits planning independent confirmation only.
