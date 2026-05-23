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

The gate requires CodeMap search+context to improve success over lexical search, improve context recall over search-only, avoid explicitly configured forbidden/noisy reads, and stay under the latency threshold.

## Current local result

On 2026-05-23, after strengthening exact/prefix symbol ranking, `npm run eval:real-repo-navigation:gate` passed on 8 local tasks with the default 5-file read budget:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.125 | 0.375 | 0.406 | 0.458 | 5.000 | 31.123 ms |
| `codemap_search` | 0.125 | 1.000 | 0.542 | 0.229 | 3.750 | 35.156 ms |
| `codemap_search_context` | 0.625 | 0.875 | 0.771 | 0.729 | 2.875 | 51.360 ms |

Deltas:

- Search+context vs lexical: `+0.500` success, `+0.365` expected recall, `+0.271` context recall, with `2.125` fewer files read on average.
- Search+context vs search-only: `+0.500` success, `+0.229` expected recall, `+0.500` context recall.

Interpretation: under a realistic small read budget, CodeMap's value is strongest when agents use the intended workflow: search for an entry point, then call context. Search-only is not enough; context supplies the neighboring test/config/doc/source files that lexical search often misses or buries behind noisy hits. The current case set is symbol/entrypoint-heavy; it does not prove arbitrary natural bug-report navigation.

## Known limitations exposed by the eval

The eval is intentionally honest. It still exposes misses:

- TypeScript path aliases such as `@/lib/...` are not fully resolved as import edges in larger apps.
- Some framework/UI-to-API relationships are convention/config based, not import based.
- Search+context is slower than lexical scanning on these small repos, though still under the local gate threshold.

These are candidates for future gated work; they should not be expanded unless this real-repo eval or a follow-up case proves the benefit.
