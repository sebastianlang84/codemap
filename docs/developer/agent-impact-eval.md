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
write aggregate evidence.

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

## Interpretation and next gate

The replay and its isolation work. The first workflow exposed a real search-to-context drop-off;
the simpler workflow removed that drop-off in the repeat smoke. Neither run showed a task-success
gain, and v3 used more tokens, time, and money. Therefore this evidence does not justify a ranking
change or a user-facing workflow change.

The next experiment is a 12-task development pilot selected before execution across several
repositories and task shapes. Dependency trees must be frozen, every task needs a repeated named
base failure plus repeated reference pass, and the manifest must set a hard total budget. Its job is
to validate adoption, scoring, variance, and operational cost. Only after that pilot may a fresh,
untouched approximately 40-task corpus test product effect; its primary outcome is paired hidden-test
success, with tokens, cost, time, and CodeMap use as secondary outcomes.
