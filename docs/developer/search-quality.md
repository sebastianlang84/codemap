# Search quality metrics and benchmark

This document explains how CodeMap search quality is measured so ranking, chunking, symbol extraction, and query-planning changes can be tuned without relying on anecdotal examples.

## Goals

The benchmark answers three questions:

1. Does a query return at least one expected file in the first five distinct paths?
2. Is the best expected file ranked first often enough?
3. Did a change introduce misses, partial misses, or latency regressions?

It is intentionally deterministic and local. It does not call an LLM or embedding service.

## Commands

Run the deterministic in-repo fixture report:

```bash
npm run bench:search-quality
```

Run the deterministic quality gate used for closeout/CI:

```bash
npm run bench:search-quality:gate
```

Run against explicit repositories for ad hoc tuning:

```bash
npm run bench:search-quality -- /path/to/repo
```

Run the opt-in local real-repo tuning profile:

```bash
npm run bench:search-quality:local
```

The default and gate commands use checked-in fixtures under `tests/fixtures/search-quality/`. They do not depend on private local repositories. `--local-repos` is the only mode that uses known local paths when present:

- `/home/wasti/macrolens`
- `/home/wasti/ai_stack/services/newsletter-writer`
- `/home/wasti/dev/autoresearch`

## Case sources

The benchmark combines two case types.

### Structural cases

If `ast-grep` is installed, the benchmark scans supported source files for cheap ground-truth symbols such as functions and classes. Each discovered symbol name becomes a query, and the defining file is the expected path.

This checks whether exact or prefix symbol searches still surface definitions near the top. `ast-grep` is used only as optional benchmark ground truth here; the production indexer remains the default cheap regex extractor.

### Removed `ast-grep` symbol-indexing prototype findings

On 2026-05-24, CodeMap evaluated and removed an opt-in `ast-grep`-supplemented symbol-indexing prototype. The prototype kept public tools unchanged and used an internal `experimentalStructuralSymbols` index path plus default-vs-experimental benchmark compare mode.

The keep rule was: keep the prototype only if repeated fixture and local-real-repo runs showed a retrieval-quality gain without relevant latency, noise, or portability cost. The prototype failed that rule.

Measured compare results before removal:

| Profile | Quality delta | Index/symbol delta | Notes |
|---|---:|---:|---|
| Fixture `agent-nav` | Top1/Recall/MRR unchanged | +162.472ms index time, +1 symbol | No misses or noise changed. |
| MacroLens local repo | Top1/Recall/MRR unchanged | +1,858.279ms index time, +3 symbols | Natural miss stayed identical. |
| Newsletter writer local repo | structural Top1 -0.024, structural MRR -0.012 | +270.56ms index time, +0 symbols | Natural metrics unchanged. |
| Autoresearch local repo | Top1/Recall/MRR unchanged | +33.689ms index time, +0 symbols | Natural miss stayed identical. |

Decision: remove the index-time prototype instead of parking unused code. `ast-grep` remains useful as optional benchmark ground truth, but production indexing stays cheap regex + SQLite/FTS. Future `ast-grep` work must start from a concrete eval miss and should be evaluated as a narrow query-time or relationship-extraction vertical, not as a broad symbol-indexing default.

### Natural-language cases

For checked-in fixtures and known local repos, the benchmark includes hand-written questions that represent agent-style navigation, for example:

- `where is the main implementation?` → `train.py`
- `where are dependencies declared?` → `pyproject.toml`
- `freshness gate evaluation matrix aggregator` → newsletter aggregator code

Natural cases can have multiple expected paths when a good answer should include several files or when a generic repo-shape query has several valid targets, such as root and workspace `package.json` manifests.

## Metrics

Metrics are computed over distinct result paths in the top five results.

| Metric | Meaning |
|---|---|
| `top1Accuracy` | Fraction of cases where the first result is one of the expected paths. |
| `recallAt5` | Fraction of cases where at least one expected path appears in the top five. |
| `expectedCoverageAt5` | Average fraction of all expected paths found in the top five. Useful for multi-file questions. |
| `mrrAt5` | Mean reciprocal rank of the first expected path in the top five. |
| `avgLatencyMs` | Average per-query search latency measured by the benchmark. |
| `p95LatencyMs` | 95th percentile per-query search latency. |
| `misses` | Cases with no expected path in the top five. |
| `partialMisses` | Multi-expected-path cases where some expected paths are missing from the top five. |

Cases with no expected paths are invalid and rejected, because they would make coverage meaningless.

## Quality gate

`npm run bench:search-quality:gate` enables the default gate:

```text
--min-top1 0.6
--min-recall-at-5 1
--min-mrr-at-5 0.85
--fail-on-misses
require at least one evaluated case per repo
```

The gate exits non-zero when a threshold fails. Informational benchmark runs still print the gate section but do not fail unless a gate flag is supplied.

Repo-selection and custom gate flags:

```text
--fixtures
--local-repos
--quality-gate
--min-top1 <0..1>
--min-recall-at-5 <0..1>
--min-coverage-at-5 <0..1>
--min-mrr-at-5 <0..1>
--max-p95-ms <milliseconds>
--fail-on-misses
--fail-on-partial-misses
```

Custom numeric thresholds must be present and in range. Supplying any custom gate flag also requires at least one evaluated case.

## Ranking/noise behavior covered by tests

The current product contract is documented in [`../product/PRD.md#12-ranking-and-noise-handling`](../product/PRD.md#12-ranking-and-noise-handling). The benchmark and unit tests act as executable documentation for these rules:

- Lockfiles are indexed so explicit queries such as `package-lock.json` can find them.
- Ordinary dependency or phrase queries should prefer source/config/docs/tests and should not include lockfiles in the top results.
- Generated/build/minified outputs are noisy signals and should not displace source matches or become read-first context neighbors.
- `codemap_context` should keep lockfile/generated/build/minified import or reverse-import neighbors out of `readFirst` while preserving useful related tests/docs.
- Ranking diagnostics exist for maintainer/debug paths and eval reports, but public `codemap_search` results stay compact and do not expose explain fields.

Relevant tests in `tests/search.test.ts` include:

- `lockfiles are indexed but only prominent for explicit lockfile queries`
- `context read-first excludes noisy generated and lockfile neighbors`
- `noisy queries keep source first and out of read-first neighbors`
- `ranking diagnostics expose score components without search API explain fields`
- `internal search debug report shows score components and candidate decisions`

## How to use this when improving CodeMap

1. Run the gate before changing search behavior.
2. Change ranking, query planning, chunking, or symbol extraction.
3. Re-run the same gate command.
4. Inspect `misses`, `partialMisses`, and `excludedHits` first; then inspect Top-1/MRR shifts.
5. Add a natural-language case when a real agent query should have found a specific file or avoided a known noise file.
6. Correct expected paths only when the query is genuinely ambiguous or multi-target; do not relax thresholds after seeing a worse score.

## Semantic comparison track

`npm run bench:semantic-quality` is a separate, machine-readable comparison track for optional semantic retrieval. It does not add embeddings to CodeMap or change the default quality gate. The checked-in `agent-navigation-semantic-v1` corpus mixes English and German queries across source, Markdown decisions/runbooks, YAML/JSON config, and exact error lookups.

The versioned manifest lives outside the indexed corpus at `tests/fixtures/semantic-quality/agent-navigation-v1.json`, so ground-truth query text cannot leak into search results. Its development split is available for tuning; the holdout split and thresholds are frozen guardrails. Changing cases, expected/excluded paths, or thresholds requires a corpus-version bump and a documented new baseline rather than relaxing the current holdout after a result is known.

Run the development report while iterating, and reserve the holdout gate for promotion checks:

```bash
npm run bench:semantic-quality
npm run bench:semantic-quality:gate
```

The first command emits only the development split. The gate command emits and evaluates both splits, which keeps routine tuning loops from seeing holdout results.

The schema records Top-1, Recall@5, MRR@5, misses, and `falsePositiveRate` per split. Resource fields record cold index/search latency, warm per-query average/P95 latency, process peak RSS, SQLite index bytes, embedding latency, and model bytes. The lexical profile reports zero for the final two fields by design.

Frozen lexical baseline on 2026-07-14:

| Split | Cases | Top-1 | Recall@5 | MRR@5 | False-positive rate |
|---|---:|---:|---:|---:|---:|
| Development | 5 | 0.4 | 0.6 | 0.5 | 0.4 |
| Holdout | 5 | 0.8 | 0.8 | 0.8 | 0.2 |

The development misses expose vocabulary mismatch intentionally; the holdout includes one German paraphrase miss. The gate freezes the holdout quality values above, caps cold indexing at 500 ms, cold search and warm P95 at 100 ms, SQLite size at 5 MiB, and peak RSS at 512 MiB. Latency and memory values are environment-sensitive guardrails, not cross-machine performance claims.

Future candidates such as BM25 plus an embedder or reranker must emit the same schema against the same corpus. Use development cases to form and tune one hypothesis at a time; inspect the holdout only for promotion. Do not promote an embedder or reranker unless it beats the lexical baseline without weakening exact path/symbol precedence or imposing unacceptable compute, index, model-download, or reliability cost.

## Latency crossover against `grep`

Measured 2026-08-06 at commit `df73adf`, warm page cache, mean of five runs, selective
identifier queries (one to nine hits). `git grep -n <identifier>` against `codemap search
<identifier>`:

| Corpus | Files | Size | `git grep` | `codemap search` |
|---|---:|---:|---:|---:|
| codemap | 245 | 1.4 MB | 3 ms | 82 ms |
| hermes | 3,427 | 66 MB | 20 ms | 84 ms |
| openclaw | 19,761 | 178 MB | 62 ms | 85 ms |
| openclaw + hermes | 23,074 | 241 MB | 77–85 ms | 89–90 ms |
| the above + 2× hermes | 29,848 | 369 MB | 113–171 ms | 94–134 ms |
| the above corpus doubled | 46,148 | 481 MB | 161–173 ms | 108–114 ms |

**The crossover sits at roughly 25,000–30,000 files (~300 MB).** Below it `grep` wins outright;
above it the index wins on latency as well as on ranking. `codemap search` is close to flat
across three orders of magnitude (82 → 114 ms) because its cost tracks the number of *hits*,
not the amount of text; roughly 20 ms of that floor is Node startup.

This holds for **selective** queries only. On a common term the picture inverts and never
crosses over: `function` on the 23,074-file corpus costs `git grep` 118 ms and `codemap search`
729 ms, because CodeMap scores thousands of candidates where `grep` only prints lines.

Caveats: sizes are the on-disk totals of tracked files, including binary assets that both tools
skip (CodeMap skipped 1,484 of 23,074 in the combined corpus). The two largest corpora were
built by copying real repositories, so their text volume scales but their vocabulary does not —
that understates index cost slightly, since a real corpus of that size would carry more distinct
terms. All figures come from one machine and one warm cache; treat the crossover as an order of
magnitude, not a threshold.

## Current limitations

- Structural ground truth depends on optional local `ast-grep`; without it, only natural cases run.
- Natural cases are hard-coded in `scripts/bench-search-quality.ts` for checked-in fixtures and optional known local repos.
- Metrics judge file-path retrieval, not whether the returned snippet is the best possible line range.
- Both benchmark tracks are designed for local tuning and regression checks, not as universal retrieval benchmarks across arbitrary projects.
