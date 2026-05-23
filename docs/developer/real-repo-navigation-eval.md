# Real-repo navigation eval

This local eval measures whether CodeMap is worth using on real repositories, not only checked-in fixtures. It indexes local repos into a temporary CodeMap state dir and compares three modes with the same default 5-file read budget:

1. `lexical` — rg-like tracked-file lexical scoring.
2. `codemap_search` — read top CodeMap search hits only.
3. `codemap_search_context` — search, then read the `codemap_context` package for the top hit.

The current local suite covers:

- `~/macrolens`
- `~/alpha-cycles`
- `~/.pi/agent/git/github.com/sebastianlang84/pi-ext-memory`
- `~/.pi/agent/git/github.com/sebastianlang84/pi-ext-subagents`
- `~/.pi/agent/git/github.com/sebastianlang84/pi-ext-astgrep`

Only paths and aggregate metrics are reported; repo contents are not copied into this package.

## Run

```bash
npm run eval:real-repo-navigation
npm run eval:real-repo-navigation:gate
```

Useful options:

```bash
npm run eval:real-repo-navigation -- --limit 8
npm run eval:real-repo-navigation -- --keep-state
npm run eval:real-repo-navigation -- --quality-gate --min-success-delta-vs-lexical 0.2
```

Because this eval depends on local repos, it is a local evidence gate, not a portable CI gate.

## Metrics

Per mode, the eval reports:

- `successRate`: entry file found, all required context found, and no forbidden file read.
- `entryHitRate`: expected entry file was read.
- `avgExpectedRecall`: recall over entry + required context files.
- `avgContextRecall`: recall over required neighboring files only.
- `avgFilesRead`: unique files read within the budget.
- `avgToolCalls`: scripted navigation calls.
- `forbiddenReadRate`: noisy or explicitly forbidden files read, such as lockfiles or stale planning/archive files.
- `avgLatencyMs` / `p95LatencyMs`.
- `missTaxonomy`: classified misses across missing expected files and forbidden/noisy reads.

The miss taxonomy is diagnostic, not a gate by itself. Current classes are:

- `alias`: expected relationship likely needs path-alias resolution.
- `convention`: expected file is related by naming/framework convention rather than a direct import/search hit.
- `missing_symbol`: symbol-like query missed the expected entry file.
- `noise`: forbidden/noisy file was selected.
- `staleness`: expected file was missing while the index was stale.
- `query_formulation`: query terms do not overlap the missing expected path.
- `unknown`: miss needs manual inspection before adding heuristics.

The gate requires CodeMap search+context to improve success over lexical search, improve context recall over search-only, avoid explicitly configured forbidden/noisy reads, and stay under the latency threshold.

## Current local result

On 2026-05-23, after strengthening exact/prefix symbol ranking and adding miss-taxonomy diagnostics, `npm run eval:real-repo-navigation:gate` passed on 8 local tasks with the default 5-file read budget:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.125 | 0.375 | 0.438 | 0.500 | 5.000 | 23.707 ms |
| `codemap_search` | 0.000 | 1.000 | 0.510 | 0.188 | 3.750 | 31.999 ms |
| `codemap_search_context` | 0.500 | 0.875 | 0.740 | 0.688 | 2.875 | 51.125 ms |

Deltas:

- Search+context vs lexical: `+0.375` success, `+0.302` expected recall, `+0.188` context recall, with `2.125` fewer files read on average.
- Search+context vs search-only: `+0.500` success, `+0.230` expected recall, `+0.500` context recall.

The eval also emits a miss taxonomy. In the latest local run after adding the taxonomy, `codemap_search_context` had 7 classified misses: 1 `alias`, 1 `convention`, 1 `missing_symbol`, 2 `query_formulation`, and 2 `unknown`; lexical had 19 misses including 5 `noise` reads.

Interpretation: under a realistic small read budget, CodeMap's value is strongest when agents use the intended workflow: search for an entry point, then call context. Search-only is not enough; context supplies the neighboring test/config/doc/source files that lexical search often misses or buries behind noisy hits. The taxonomy turns remaining misses into actionable next slices instead of broad guesses. The current case set is symbol/entrypoint-heavy; it does not prove arbitrary natural bug-report navigation.

## Known limitations exposed by the eval

The eval is intentionally honest. It still exposes misses:

- TypeScript path aliases such as `@/lib/...` are not fully resolved as import edges in larger apps.
- Some framework/UI-to-API relationships are convention/config based, not import based.
- Search+context is slower than lexical scanning on these small repos, though still under the local gate threshold.

These are candidates for future gated work; they should not be expanded unless this real-repo eval or a follow-up case proves the benefit.
