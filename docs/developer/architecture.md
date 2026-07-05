# CodeMap developer architecture

This document is the canonical maintainer reference for CodeMap internals. Product scope lives in [`../product/PRD.md`](../product/PRD.md); user-facing command usage lives in [`../user/usage.md`](../user/usage.md).

## Architecture boundary

CodeMap is split into thin adapter layers (Pi extension, CLI, MCP server) over a Pi-independent core.

- `src/core/` owns product logic: repo detection, approval, DB paths, indexing, search, context building, and structured result objects.
- `src/core/` must stay independent of Pi extension APIs: no `ExtensionAPI`, `ctx`, `pi`, slash-command parsing, tool rendering, or `console.log()` output behavior.
- `src/core/operation-metadata.ts` (tool names, descriptions, prompt snippets/guidelines, TypeBox parameter schemas) and `src/core/operations.ts` (the Pi-free `codeMapStatus/Index/Search/Context` executors plus `operationCwd` repoPath resolution) are the shared operation surface every adapter reuses, so the four `codemap_*` operations are described and executed identically everywhere.
- `src/pi-extension/` owns tool/command registration, command parsing, UI notifications, and TUI rendering; it re-exports the core executors and wraps the shared metadata.
- `src/cli/` is the standalone-CLI adapter (`bin/codemap.ts` entrypoint, `codemap` bin) for shell-driven agents. It parses argv, calls the same core APIs, and formats text/JSON output; `runCli` returns `{ code, out, err }` instead of writing/exiting so it stays testable.
- `src/mcp/` is the Model Context Protocol adapter (`bin/codemap-mcp.ts` entrypoint, `codemap-mcp` bin, protocol revision `2025-11-25`) for MCP hosts such as Claude Code, Codex, and Cursor. `dispatch()` is a pure, synchronous JSON-RPC 2.0 handler (`initialize` / `tools/list` / `tools/call` / `ping` / notifications) that exposes the shared metadata as MCP tools and calls the core executors; the bin only frames newline-delimited JSON over stdio. No SDK/runtime dependency is added. Token-lean by design: tool-call `content` is a compact ranked summary (the full object rides in `structuredContent` once, never duplicated as pretty JSON text); read tools carry `readOnlyHint` annotations; unknown-tool and execution failures are returned as Tool Execution Errors (`isError`, per SEP-1303) so the model can self-correct, while only unknown JSON-RPC methods are protocol errors.
- No adapter imports another adapter (`src/pi-extension/`, `src/cli/`, `src/mcp/` only depend on `src/core/`), and none duplicates status/index/search/context behavior.
- Core state and execution context should be injectable where practical (`cwd`, `stateDir`) so tests and adapters can choose output/state behavior without changing product logic.
- The root `index.ts` remains a thin package entrypoint shim for the Pi manifest.

Key current structure:

```text
pi-ext-codemap/
  README.md
  index.ts
  docs/
    product/
      PRD.md
      roadmap.md
    user/
      usage.md
    developer/
      architecture.md
      qmd-research.md
      search-quality.md
    archive/
      brainstorming.md
  migrations/
    001_init.sql
    002_fts.sql
  bin/
    codemap.ts
    codemap-mcp.ts
  src/
    core/
    pi-extension/
    cli/
    mcp/
  tests/
  scripts/
  package.json
```

## Storage

CodeMap uses local per-repo SQLite databases plus a global registry:

```text
~/.pi/agent/state/codemap/
  registry.sqlite
  repos/
    <repo-hash>.sqlite
```

Rationale:

- simple cleanup per repo;
- less locking contention;
- easier debugging;
- avoids committing DBs into repos;
- keeps registry separate from rebuildable index content.

Because per-repo DBs and registry approvals outlive the repos they mirror, `src/core/state-gc.ts` provides `collectStateGcCandidates` (read-only plan) and `pruneState` (apply). They reclaim two classes of leftover state: orphan `<key>.sqlite` files with no registry row, and DBs/registry rows for repo roots that no longer exist on disk. The `gc:state` script is a thin adapter (dry-run by default, `--apply` to delete, `--json` for machine output). Index DBs are rebuildable, so pruning only clears cached content and stale approvals; it never touches DBs whose repo root still exists.

## Database design

Use Node.js `node:sqlite` `DatabaseSync` plus raw SQL migrations. Do not introduce Prisma or an ORM.

Registry table:

```sql
repos(
  key text primary key,
  root_path text not null unique,
  git_remote text,
  enabled integer not null,
  approved_at text not null,
  approval_source text not null,
  updated_at text not null
);
```

Per-repo index tables:

```sql
meta(key text primary key, value text not null);

files(
  id integer primary key,
  path text not null unique,
  language text not null,
  size integer not null,
  hash text not null,
  mtime_ms real not null,
  indexed_at text not null
);

chunks(
  id integer primary key,
  file_id integer not null references files(id) on delete cascade,
  ordinal integer not null,
  start_line integer not null,
  end_line integer not null,
  kind text not null,
  text text not null,
  unique(file_id, ordinal)
);

symbols(
  id integer primary key,
  file_id integer not null references files(id) on delete cascade,
  name text not null,
  kind text not null,
  start_line integer not null,
  end_line integer,
  signature text
);
```

FTS tables are contentless FTS5 (`content='', contentless_delete=1`):

```sql
chunks_fts(path, language, kind, text)   using fts5(..., content='', contentless_delete=1);
symbols_fts(path, name, kind, signature) using fts5(..., content='', contentless_delete=1);
```

The search read path uses the FTS tables only for `MATCH`/`bm25()` and joins back to `chunks`/`symbols`/`files` (by `rowid = chunks.id` / `symbols.id`) for display, so no FTS-stored column text is ever read. Contentless FTS therefore drops the duplicated `%_content` shadow (~40% smaller DB on a code-heavy repo) with identical matching. Index maintenance deletes FTS rows by rowid (contentless tables cannot filter by column), so `src/core/index-store.ts` clears FTS entries before the base rows they reference are removed. Legacy content-owning FTS databases are converted in place and repopulated from the base tables by `normalizeFtsSchema` in `src/core/db.ts`, so upgrades need no reindex.

## Scanner and indexing policy

Default indexing is whitelist-first. The scanner should:

- require explicit approval before first indexing;
- stay inside the current or explicitly targeted Git repository boundary;
- respect `.gitignore` and optional `.codemapignore` rules;
- skip symlinks;
- skip binaries, unsupported extensions, secret-like files, generated/cache/build/dependency folders, and files larger than 1 MB;
- support common source, docs, config, SQL, CSS/HTML, shell, and plain-text extensions;
- use hash/mtime checks for incremental refreshes;
- remove deleted files from the index;
- keep indexing manual/on-demand, not daemonized.

Lockfiles are supported text files, not generated binaries. They may be indexed for explicit lockfile queries but are penalized in ordinary ranking and filtered from related read-first neighbors.

Symbol extraction uses cheap deterministic regexes. `ast-grep` is not part of indexing; when installed locally, the search-quality benchmark may use it only as optional structural ground truth.

### Language support tiers

Priority languages are TypeScript, JavaScript, C, and C++ (product scope in [`../product/PRD.md#priority-languages`](../product/PRD.md#priority-languages)). Support is layered per capability, so a language may have symbols without structured chunking:

| Capability | Languages |
| --- | --- |
| Text / FTS indexing | all whitelisted extensions (see scanner allowlist) |
| Symbol extraction (`src/core/symbols.ts`) | TypeScript, JavaScript, Python, C, C++ (+ Markdown headings) |
| Structured (brace/indent) chunking (`src/core/chunker.ts`) | TypeScript, JavaScript, Python |
| Import/include relationships (`src/core/relationships.ts`) | TypeScript/JavaScript imports, Python relative imports, C/C++ quoted includes |

C/C++ file extensions are normalized to canonical `c`/`cpp` language tags in `src/core/scan-policy.ts`. A language outside a given row falls back to the lighter behavior (fixed-window chunks, no symbols or relationships). Structured chunking for C/C++ is a known gap tracked in the backlog.

## Search and ranking

V1 ranking is deterministic and lexical/local-first. Embeddings are not part of V1 ranking.

Primary positive signals:

1. Exact path/name match.
2. Exact or prefix symbol match.
3. SQLite FTS chunk/symbol match.
4. Token coverage in path, filename, symbol, and chunk text.
5. Query-intent boosts for implementation/config/dependency/docs/tests where applicable.
6. File-role boosts such as implementation entrypoints or dependency manifests.

Noise handling:

- Lockfiles receive a strong noise penalty for ordinary queries; explicit lockfile/path queries can still surface them first.
- Generated files, build output, vendor/output folders, and minified files are strongly de-prioritized or skipped depending on scan policy.
- Tests and docs are useful context, not generic noise.
- Public `codemap_search` results stay compact and do not expose ranking explain fields.
- Internal score diagnostics may decompose retrieval/FTS/path/filename/symbol/coverage/role/noise components for tests and benchmark debugging.

Search-quality gates and diagnostics are documented in [`search-quality.md`](search-quality.md). Navigation eval scripts share Pi-independent assessment, metric, diagnostic-shaping, and Search+Context lookup helpers in `src/core/navigation-eval.ts`; scripts should remain suite/CLI adapters around that core seam.

## Context builder

`codemap_context` builds a compact read-first package for an indexed file path or falls back to search results for a symbol/query.

For direct file targets, context can include:

- target file chunks;
- directly imported/included local files;
- indexed local files that import/include the target;
- C/C++ header/source implementation pairs;
- narrow Next.js-style route↔handler convention pairs when route path terms match `*handler*` source files;
- nearby configuration files;
- same-directory source neighbors;
- likely sibling/reverse tests and source files under test;
- likely related docs.

Each `readFirst` item may carry `reasons[]` such as `target`, `import`, `reverse_import`, `include`, `reverse_include`, `implementation_pair`, `near_config`, `same_dir`, `test_of`, `sibling_test`, `reverse_test`, or `related_doc`. Relationship extraction is a lightweight core seam in `src/core/relationships.ts`: TypeScript/JavaScript imports, Python explicit relative imports, nearby config files, same-directory source neighbors, test/source roles, C/C++ quoted includes, narrow route↔handler convention pairs, and path/name test-doc heuristics are supported; full AST/callgraph/package resolution is intentionally out of scope.

Related imports/reverse-imports/includes are resolved from indexed content, so context remains useful even when the working tree is stale. `pathPrefix` must scope context and related-file discovery to the requested subtree.

Noisy related paths — lockfiles, generated files, build output, minified files — are filtered out of `readFirst`, while an explicitly requested noisy target may still be returned directly.

## Tool API contracts

The public Pi tool/command surface is intentionally small:

- `codemap_status`
- `codemap_index`
- `codemap_search`
- `codemap_context`

All four tools/commands default to cwd and optionally accept `repoPath` / `--repo-path`. The Pi adapter resolves repoPath to a directory cwd before calling core APIs, so core stays cwd-oriented and adapter-independent.

Detailed user-facing command usage is in [`../user/usage.md`](../user/usage.md). Product-level contracts are in [`../product/PRD.md#11-tool-api-contract`](../product/PRD.md#11-tool-api-contract).

## Testing policy

Tests should assert external behavior and contracts: indexed files, skipped files, tool outputs, warnings, and ranking order for representative cases.

Coverage expectations:

- Scanner tests: allowlists, default excludes, `.gitignore`, `.codemapignore`, size limits, symlinks, deleted files, secret-like files.
- Migration/database tests: schema creation, FTS table availability, uniqueness constraints, repeatable migrations.
- Indexer tests: first indexing, incremental no-op indexing, changed files, deleted files, failed runs.
- Chunker tests: code, Markdown headings, fenced code blocks, plain text, line ranges, overlap/default sizing, truncation-safe snippets.
- Search tests: path matches, symbol matches, FTS chunk matches, doc matches, test boosts, limits, empty results, ranking/noise behavior.
- Context tests: read-first ordering, relationship reasons, related tests/docs/imports/includes/callers, budget limits, stale warnings, missing target behavior, `pathPrefix` scoping.
- Safety tests: unapproved repos cannot be indexed; paths outside the repo root are rejected.
- Package/integration tests: the Pi extension loads and each V1 tool validates inputs and returns the documented contract.

Run the closeout gate when local real-repo eval dependencies are available:

```bash
npm run verify
```

`npm run verify` chains typechecking, the test suite, search/context/navigation quality gates, and the token-injection budget check. Because the real-repo navigation gate depends on local repositories, use the individual scripts when that local gate is unavailable.

Useful individual checks:

```bash
npm run typecheck
npm test
npm run check:token-injection
npm run audit:lightweight
npm run bench:search-quality:gate
```

`npm run check:token-injection` reports the estimated agent-context cost of registered Pi tools (`description`, `parameters`, `promptSnippet`, and `promptGuidelines`) and fails when the default budgets are exceeded: 190 estimated tokens per tool and 700 estimated tokens total. Slash commands are not counted because they are not injected as tool prompt/schema context.
