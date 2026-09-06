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
tokens and no more than 10% additional agent time. Search and context adoption is reported
separately; all assigned pairs count, including non-use. A small descriptive result
cannot establish general benefit. Failure leaves CodeMap in maintenance-only status;
a pass supports a further decision, not an automatic larger experiment.

Full test output handling stays identical between arms. Token totals include cached input;
source-output size is not used as a substitute for agent tokens. Raw traces remain outside
Git with a hash inventory; the stable result and interpretation belong here in the repo.
