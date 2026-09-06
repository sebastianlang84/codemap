# Optional CodeMap: frozen development comparison

Status: [8/8 oracles validated](agent-impact-optional-readiness.json): each base fails twice,
each reference fix passes twice. Paid execution requires separate approval; no product benefit claimed.
The [manifest](../../scripts/eval-agent-impact-optional.manifest.json) pins eight tasks,
CodeMap, model, effort, prompts, dependencies, order seed and regression tests.

Normal adaptive agent tools versus the same agent with optional CodeMap. Treatment receives
one short CLI instruction including `context --json` for source excerpts. Both arms use the
same setup-token authentication. Non-use remains in the assigned treatment arm; adoption is
reported, not required. This tests the current optional workflow, not the isolated effect of
the nested-function fix. No candidate outputs or agent attempts informed selection.

| Repository / PR | Behavior | Discovery stratum |
| --- | --- | --- |
| Express 4893 | Transfer-Encoding without conflicting Content-Length | direct API |
| Express 6903 | null/undefined rendering options | direct API |
| Express 4885 | multiple links per relation | direct API |
| Express 6073 | file response respects application ETag setting | cross-component |
| Fastify 6483 | falsy validator replacements | cross-component |
| Fastify 6838 | case-insensitive route lookup | direct API |
| Fastify 6680 | port follows effective forwarded host | cross-component |
| Fastify 6753 | recognize and protect built-in decorated properties | cross-component |

Selection: descending cached main history, four qualifying numbered runtime fixes per repo.
Exclude all previous agent-impact/external-navigation cases, duplicate behavior, missing
regression tests, behavior-equivalent refactors and cosmetic-only changes. Express exclusions:
7366 duplicates previously used 7377; 7265/6991 used; 6464/6405 lack tests; 5167 only HTML
serialization polish; 6088/6897/6705/6520/6525/6137 refactor/cleanup. Fastify: previously used
6965/6942/6940/6892/6889/6881/6879/6865/6860/6846/6845/6803/6719; 6837 lacks tests;
6830 mixes response behavior with new internal cache APIs required by its tests; 6810
passed twice on its base and was replaced before any agent run (see
[preflight exclusion](agent-impact-optional-exclusion.json)).
Docs/build/dependency/test-only changes and unnumbered changes are excluded throughout.
The strata describe expected discovery work, not measured difficulty. The untouched holdout
remains reserved. Two JavaScript frameworks do not establish cross-language generality.

Decision rule, before execution: all eight pairs valid, zero cross-arm contamination, no
budget exhaustion, same pinned actual model and authentication, zero paired success losses,
aggregate provider-cost ratio <= 0.85, token and agent-time ratios each <= 1.10. Raw traces
and checkpoint evidence are mandatory. Report all pairs and repository/stratum breakdowns,
including non-use and failures. Tokens include cache reads and writes; provider cost is the
CLI-reported USD equivalent, not necessarily a subscription invoice. Index/setup time is
reported separately; agent time is warm-use time. Thresholds are engineering continuation
criteria, not statistical significance. Pass permits planning independent confirmation;
fail/inconclusive means maintenance-only, without another automatic tuning/paid cycle.

Budget: 16 attempts, $2 per attempt, $32 configured total cap; medium effort and 15-minute
per-attempt timeout. No retries of paid failures. Preserve incomplete evidence and stop for
provider/authentication failures; do not replace the provider or silently broaden approval.

Local validation (no paid agents):

```sh
npm run eval:agent-impact -- --manifest scripts/eval-agent-impact-optional.manifest.json --cache-dir /home/wasti/.cache/codemap/external-holdout-v1 --offline --validate-oracles
npm run eval:agent-impact -- --manifest scripts/eval-agent-impact-optional.manifest.json --dry-run
```

After explicit budget approval only (existing token file; no credential changes):

```sh
CODEMAP_EVAL_OAUTH_TOKEN_FILE="$HOME/.agents/secrets/codemap-claude-token" \
  npm run eval:agent-impact -- \
  --manifest scripts/eval-agent-impact-optional.manifest.json --cache-dir /home/wasti/.cache/codemap/external-holdout-v1 --offline \
  --approve-budget-usd 32 --quality-gate \
  --trace-dir /tmp/codemap-agent-traces \
  --evidence-output docs/developer/agent-impact-optional-result.json
```

Keep private raw traces outside Git. Before any interrupted-run resume, verify the pinned
manifest, model, CLI version, evidence and trace completeness; remaining approval must cover
remaining attempts. Do not interpret a passing efficiency gate without the pilot gate and
complete traces. Oracle readiness is recorded separately from paid results.
