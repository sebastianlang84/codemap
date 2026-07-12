# CodeMap developer architecture

This document is the canonical maintainer reference for CodeMap internals. Product scope lives in [`../product/PRD.md`](../product/PRD.md); user-facing command usage lives in [`../user/usage.md`](../user/usage.md).

## Architecture boundary

CodeMap is a CLI-first product with thin CLI, MCP, and Pi adapters over one host-neutral application surface and core.

- `src/core/` owns repository and retrieval mechanics: repo detection, approval, DB paths, indexing, search, context building, and structured result objects. It imports neither application nor adapter code.
- `src/application/operations.ts` is the use-case boundary shared by every adapter. It owns `repoPath` resolution and the four `codeMapStatus/Index/Search/Context` executors.
- `src/application/operation-metadata.ts` owns the compact TypeBox schemas and agent-facing metadata shared by MCP and Pi. CLI help/output stays adapter-specific and is not injected into agent context.
- `src/cli/` is the primary standalone adapter. It parses argv, calls only the application operations, and formats text/JSON output; `runCli` returns `{ code, out, err }` for tests. `src/cli/bin.ts` compiles to the published `dist/cli/bin.js` executable.
- `src/mcp/` wraps the same operations as MCP tools (`dist/mcp/bin.js`, protocol revision `2025-11-25`). `dispatch()` is a pure JSON-RPC handler; the bin only frames newline-delimited stdio. Compact text goes in `content`, while the full object appears once in `structuredContent`.
- `src/pi-extension/` owns Pi registration, slash-command parsing, UI notifications, status rendering, and bash nudges. The package manifest points directly at its TypeScript entrypoint; Pi dependencies are optional peers for CLI/MCP-only installs.
- No adapter imports another adapter or bypasses `src/application/` to call `src/core/` directly. `scripts/audit.mjs` enforces this one-way boundary.
- State and execution context remain injectable (`cwd`, `stateDir`) so adapters and tests choose paths without changing product behavior.

Key current structure:

```text
codemap/
  README.md
  docs/
    product/
      PRD.md
      roadmap.md
    user/
      usage.md
      migrating-from-pi-extension.md
    developer/
      architecture.md
      qmd-research.md
      search-quality.md
    archive/
      brainstorming.md
  migrations/
    001_init.sql
    002_fts.sql
  src/
    application/
    core/
    pi-extension/
    cli/
    mcp/
  dist/                 # versioned CLI/MCP/application/core JavaScript for compiler-free installs
  tests/
  scripts/
  package.json
```

## Storage

CodeMap uses local per-repo SQLite databases plus a global registry. Resolution order is explicit `stateDir`, `CODEMAP_HOME`, `$XDG_DATA_HOME/codemap`, then `~/.local/share/codemap`:

```text
~/.local/share/codemap/
  registry.sqlite
  repos/
    <repo-hash>.sqlite
```

For compatibility, an existing `~/.pi/agent/state/codemap` remains active when no override is set and the platform-neutral default does not yet exist. CodeMap never moves or merges SQLite state automatically; the user migration procedure is documented in [`../user/migrating-from-pi-extension.md`](../user/migrating-from-pi-extension.md).

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

## Operation contracts

The public operation surface is intentionally small:

- `codemap_status`
- `codemap_index`
- `codemap_search`
- `codemap_context`

All four operations default to cwd and can target another repository (`--repo` in the CLI, `repoPath` in MCP/Pi tools, `--repo-path` in Pi commands). The application layer resolves that target before invoking cwd-oriented core functions.

Detailed user-facing command usage is in [`../user/usage.md`](../user/usage.md). Product-level contracts are in [`../product/PRD.md#11-operation-contract`](../product/PRD.md#11-operation-contract).

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
- Package/integration tests: built CLI/MCP bins ship, the Pi extension loads, adapter boundaries remain one-way, and each public surface returns the documented contract.

Run the deterministic closeout gate:

```bash
npm run verify
```

`npm run verify` chains typechecking, the production build, test suite, checked-in search/context/navigation quality gates, and token-injection check. It is reproducible without maintainer-specific repositories. `npm run verify:local` adds the live real-repo navigation gate; its external cohort can drift independently and should be compared against unchanged `main` before attributing a failure to a patch.

Useful individual checks:

```bash
npm run typecheck
npm run build
npm test
npm run check:token-injection
npm run audit:lightweight
npm run bench:search-quality:gate
```

`npm run check:token-injection` reports the estimated agent-context cost of registered agent tools (`description`, `parameters`, `promptSnippet`, and `promptGuidelines`) against soft warning targets of 300 estimated tokens per tool and 900 total. Slash commands are not counted because they are not injected as tool prompt/schema context.
