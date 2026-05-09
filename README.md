# pi-ext-code-search

Local SQLite/FTS codebase search and context tools for Pi coding agents.

## Tools

- `codebase_status` — show approval/index diagnostics for the current Git repo.
- `codebase_index` — approve and/or refresh the local index.
- `codebase_search` — search indexed paths, symbols, and chunks; returns `{ query, root, stale, changed, missing, deleted, warnings, results }` so stale-index warnings are visible when the local index is out of date.
- `codebase_context` — get a compact read-first context package for a path or symbol; includes `{ stale, changed, missing, deleted, warnings }` diagnostics.

## Commands

- `/codebase-status`
- `/codebase-index --approve-repo`
- `/codebase-search <query>`
- `/codebase-context <path-or-symbol>`

## Safety model

Indexing is local-only and limited to the current Git repository. First indexing requires explicit approval via `approveRepo: true` or `/codebase-index --approve-repo`. Symlinks, secret-like files, binary/generated files, and common heavy directories are skipped.

Search and context tools are warn-only when the index is stale: they surface changed/missing/deleted counts but do not silently mutate the repository index. Refresh explicitly with `codebase_index` or `/codebase-index`.

## Development

```bash
npm install
npm run typecheck
npm test
pi -e .
```

Indexes are stored under `~/.pi/agent/code-search/`.
