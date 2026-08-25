# External navigation holdout

## Purpose

This eval tests whether CodeMap's five-file read plan transfers to repositories and changes that
were not used to develop its ranking. It measures navigation, not whether an agent produced a
correct patch or passed tests.

The manifest was frozen before the first CodeMap run on 2026-08-25. It contains 40 merged public
changes from Express, Fastify, Flask, GitHub CLI, ripgrep, and libuv. For each case:

- the query is the merged change title;
- the repository is checked out at the first parent of the merge/fix commit;
- expected paths are qualifying source, test, or config files changed by the fix and already present
  in that base snapshot;
- documentation, CI, lockfiles, generated files, changelog entries, and central build/test
  registration files are excluded from ground truth;
- files added by the fix are excluded because they cannot be found in the base snapshot;
- every mode gets the same five-file cap.

The checked-in manifest pins complete Git SHAs and the test suite asserts its normalized SHA-256, so
queries or expected paths cannot change silently. The source URL must point to the declared GitHub
repository. The title equality remains human-auditable through that link; it is not independently
fetched during an offline run.

The separate oracle audit enumerates every changed path omitted from ground truth and gives a bounded
reason. At runtime, the union of expected and excluded paths must equal the complete fix diff; expected
paths must exist in the base snapshot, and `not_present_at_base` exclusions must not. Its normalized
SHA-256 is `0f53d7d6cdaefca5836755fa4aecf99a8b69e3f75c6b0ae50f511d3e7145a163`.
The harness itself enforces both frozen hashes. A different manifest/audit pair requires the explicit
`--allow-custom-corpus` flag and is not a reproduction of v1.

The manifest identifies the historical CodeMap implementations independently:

- baseline 0.9.0: commit `b65223900a437cdebd836dd698995efd8a7aba7b` (there is no 0.9.0 tag);
- candidate 0.9.1: commit `6b5d941ee5f686b4966fd46322eac67c2c75eb9d`.

The harness materializes those commits in isolated clones, installs declared production dependencies
with lifecycle scripts disabled, and calls their actual compiled CLI. It does not import the current
checkout's search or context implementation. `CODEMAP_TELEMETRY=0` is set, and each profile/case uses
separate state.

## Frozen gate

The gate was declared before the first run:

- at least 40 cases from at least six repositories;
- candidate complete-success delta versus lexical ≥ 0.10;
- candidate estimated-token ratio versus lexical ≤ 0.75;
- candidate complete-success delta versus 0.9.0 ≥ 0.

Complete success means every expected path was present in the five-file plan. Expected-path recall is
also reported, but was deliberately not added to the frozen gate after seeing the result. Adding a
post-hoc threshold would not strengthen the first-run evidence; the next untouched holdout must
predeclare recall non-inferiority.

## First unseen result

The first run passed unchanged. Manifest SHA-256:
`94a8cb51d6bdb822855e1de6b821c33d893c7bf47069f057f43f6133c2f599af`.
The offline rerun reproduced the same qualitative result SHA-256:
`b3ebe357dfba046bad8731f8da4c7990b9db28ad1730a880695396d75a4f43f0`.
The checked-in [deterministic full result](https://github.com/sebastianlang84/codemap/blob/v0.10.0/docs/developer/external-holdout-v1-result.json) contains all 200 case/mode
rows, per-repository metrics, paired comparisons, and the gate without nondeterministic timestamps or
latencies. Its normalized SHA-256 is
`0bcd5d1b9534d762822bd07ac9e39d4590fb25753a2e0e780d71373e104a10cc`.

| Mode | Complete success | Expected-path recall | Avg files | Avg bytes read | Avg est. tokens read |
|---|---:|---:|---:|---:|---:|
| frozen lexical | 0.250 | 0.3579 | 5.000 | 456,687 | 114,172 |
| CodeMap 0.9.0 search | 0.400 | 0.5842 | 4.925 | 129,797 | 32,449 |
| CodeMap 0.9.0 search→context | 0.400 | 0.5842 | 4.925 | 129,797 | 32,449 |
| CodeMap 0.9.1 search | 0.400 | 0.5842 | 4.925 | 129,797 | 32,449 |
| CodeMap 0.9.1 search→context | **0.425** | 0.5717 | 5.000 | **117,775** | **29,444** |

The candidate gained 17.5 percentage points of complete success over lexical and used 74.2% fewer
estimated read tokens. Lexical and candidate context both averaged five files, so this difference is
file size rather than a lower file count. The lexical comparator searches every tracked text file,
including docs and changelogs, like a broad `rg`; CodeMap uses its product index exclusions. The
comparison therefore measures the product workflows, not identical candidate sets.

Versus 0.9.0 the candidate gained one net case (+2.5 points) but lost 1.25 points of expected-path
recall. CodeMap 0.10.0 retains the 0.9.1 navigation implementation; the release adds the measurement
harness and aggregate usage report, not a new ranking.

Paired candidate-context diagnostics:

| Comparison | Success wins/losses/ties | Recall wins/losses/ties | Exact two-sided p |
|---|---:|---:|---:|
| versus lexical | 9 / 2 / 29 | 17 / 6 / 17 | 0.06543 |
| versus CodeMap 0.9.0 | 3 / 2 / 35 | 3 / 3 / 34 | 1.0 |

The two complete-success losses versus 0.9.0 were `express-pr-7265` and `libuv-pr-5206`. The recall
losses were those two plus `gh-cli-pr-13967`. These remain visible regression targets; the gate was
not relaxed or expanded after inspection. Neither paired success difference is statistically
significant at 0.05; treat both as directional evidence.

Repository-level complete success shows the variance hidden by the aggregate:

| Repository | Cases | lexical | 0.9.0 context | 0.9.1 context |
|---|---:|---:|---:|---:|
| Express | 4 | 0.250 | 0.250 | 0.000 |
| Fastify | 8 | 0.000 | 0.000 | 0.125 |
| Flask | 7 | 0.143 | 0.429 | 0.429 |
| GitHub CLI | 5 | 0.200 | 0.000 | 0.200 |
| libuv | 8 | 0.250 | 0.750 | 0.750 |
| ripgrep | 8 | 0.625 | 0.750 | 0.750 |

## Reproduce

Run these maintainer commands from a Git source checkout. Eval scripts are deliberately excluded from
the installed product package. The first run needs network access to clone/cache the public
repositories, materialize the pinned CodeMap profiles, and install their production dependencies:

```bash
npm run eval:external-holdout:gate
```

After the cache exists, an offline rerun is available:

```bash
npm run eval:external-holdout:gate -- --offline
```

Regenerate the deterministic full evidence file with:

```bash
npm run eval:external-holdout:gate -- --offline \
  --evidence-output docs/developer/external-holdout-v1-result.json
```

Use `--case <id>` only for harness development or diagnosis; it cannot satisfy the 40-case gate.
`--cache-dir <path>` selects a persistent cache outside the repository. Latency is reported but not
gated because machines and profile execution order affect it.

## Claim boundary

The first run is valid external, previously unseen navigation evidence for CodeMap 0.9.1. Once the
results were inspected, this exact corpus stopped being an unseen holdout and became external
regression evidence. It must not be used to claim that future ranking changes generalize unless those
changes also pass a new untouched holdout.

The eval does not measure patch correctness, test success, task completion time, or agent behavior
without a scripted five-file budget. Those require a separate end-to-end agent-task replay.
