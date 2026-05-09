# pi-ext-code-search

Local SQLite/FTS codebase search and context tools for Pi coding agents.

## Tools

- `codebase_status` — show approval/index diagnostics for the current Git repo; cheap by default, pass `full: true` for stale-index counts.
- `codebase_index` — approve and/or refresh the local index.
- `codebase_search` — search indexed paths, symbols, and chunks; returns `{ query, root, stale, changed, missing, deleted, warnings, results }` so stale-index warnings are visible when the local index is out of date.
- `codebase_context` — get a compact read-first context package for a path or symbol; includes `{ stale, changed, missing, deleted, warnings }` diagnostics.

## Commands

- `/codebase-status` (`--full` for stale-index counts)
- `/codebase-index --approve-repo`
- `/codebase-search <query>`
- `/codebase-context <path-or-symbol>`

## Safety model

Indexing is local-only and limited to the current Git repository. First indexing requires explicit approval via `approveRepo: true` or `/codebase-index --approve-repo`. Symlinks, secret-like files, binary/generated files, and common heavy directories are skipped.

Search and context tools are warn-only when the index is stale: they surface changed/missing/deleted counts but do not silently mutate the repository index. Refresh explicitly with `codebase_index` or `/codebase-index`.

`codebase_status` is intentionally cheap by default for agent startup/status checks: it reports approval, DB counts, and last-index metadata without hashing the whole repo. Use `codebase_status({ full: true })` or `/codebase-status --full` when you need exact changed/missing/deleted diagnostics.

## Lightweight checks

Code-search is kept lightweight by avoiding runtime dependencies, bounding file sizes/results/snippets, skipping generated/heavy/secret-like inputs, and storing only local SQLite indexes. Run:

```bash
npm run audit:lightweight
```

The audit verifies there are no runtime dependencies, the Pi extension entry exists, tracked files do not include local indexes or obvious secrets, the package tarball remains small, and typecheck/tests pass.

## Development

```bash
npm install
npm run typecheck
npm test
npm run audit:lightweight
pi -e .
```

Indexes are stored under `~/.pi/agent/code-search/`.
