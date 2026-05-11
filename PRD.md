# PRD: pi-ext-codemap

## 1. Summary

`pi-ext-codemap` is a lightweight local codebase search and context extension for Pi/Coding Agents.

It indexes the current repository state into a local SQLite/FTS5 database and provides agent-friendly tools for finding relevant files, line ranges, snippets, docs, tests, and entry points.

It complements `pi-memory` but is not part of it.

```text
pi-memory stores durable decisions.
pi-ext-codemap indexes current repo state.
```

## 2. Problem

Coding agents often need fast, low-noise repo context before making changes:

- Which files are relevant to a task?
- Where is a symbol, feature, or subsystem implemented?
- Which tests or docs should be read before editing a file?
- What line ranges are worth inspecting without dumping entire files?

Current options are either too primitive, too broad, or too heavy:

- `rg` is excellent but returns raw matches, not curated context.
- LSPs focus on editor integration, not compact agent context packages.
- GitNexus is more powerful than needed for this lightweight use case.
- `pi-memory` is for durable semantic memory, not rebuildable repo indexes.

## 3. Solution

From the user's perspective, `pi-ext-codemap` provides a small set of Pi-native commands and tools that can approve, index, search, and explain a repository locally. The agent can ask for a query, file, or symbol and receive a compact read-first context package with paths, line ranges, snippets, related tests/docs, and index health warnings.

The V1 solution is intentionally lexical/local-first: SQLite + FTS5 + cheap symbol extraction + deterministic ranking. Embeddings, graph expansion, and ast-grep integrations remain later enhancements unless they can be added without making V1 heavier.

## 4. User Stories

1. As a Pi coding agent, I want to search a repo by feature, symbol, or phrase, so that I can find relevant files before editing.
2. As a Pi coding agent, I want line-bounded snippets, so that I can read targeted ranges instead of whole files.
3. As a Pi coding agent, I want a read-first context package for a file or symbol, so that I can inspect likely dependencies, tests, and docs in the right order.
4. As a Pi coding agent, I want stale-index warnings, so that I do not rely on outdated search results.
5. As a human Pi user, I want explicit repo approval before indexing, so that the tool never scans arbitrary private folders.
6. As a human Pi user, I want status diagnostics, so that I can see whether a repo is approved, indexed, stale, or partially skipped.
7. As a future extension author, I want a simple local index API, so that other Pi workflows can reuse file, chunk, symbol, and context results.
8. As an agent resuming work from a handoff, I want stable file and line references, so that I can quickly reopen the relevant code context.
9. As a privacy-conscious user, I want local-only storage, so that no repository content leaves the machine.
10. As a maintainer, I want cheap incremental indexing, so that repeated searches do not require full rescans.

## 5. Goals

### Product Goals

- Provide a small local repo navigation tool for Pi agents.
- Return compact, useful context packages with minimal token waste.
- Keep all indexing local and rebuildable.
- Avoid daemon, server, cloud, or heavy graph dependencies.
- Make FTS/path/symbol/doc search useful before adding embeddings.

### V1 Technical Goals

- Local per-repo SQLite database.
- SQLite FTS5 full-text search.
- Repo scanner with allowlist/ignore rules.
- Hash/mtime-based incremental indexing.
- Chunking for code, Markdown, and text.
- Search results with paths, line ranges, snippets, and ranking metadata.
- `codemap_context` tool that answers: “What should the agent read first?”

## 6. Out of Scope / Non-Goals

V1 is not:

- a full code intelligence server
- a daemon
- a remote service
- a GitNexus clone
- a Neo4j/external graph system
- a perfect callgraph
- a replacement for ripgrep, LSP, or GitNexus
- an embeddings-first semantic search product
- a whole-codebase AI summarizer

## 7. Users

Primary users:

- Pi coding agents
- Human users operating Pi inside a repo

Secondary users:

- Future Pi extensions that need compact code context
- Handoff/memory workflows that want to reference files, symbols, or line ranges

## 8. Core Use Cases

### UC1: Search the repo

User or agent asks:

```text
Find auth middleware tests
```

Tool returns ranked files/chunks with snippets and line ranges.

### UC2: Build an edit context

Agent asks:

```text
What should I read before changing src/auth/middleware.ts?
```

Tool returns:

- target file ranges
- nearby symbols/chunks
- likely tests
- relevant docs/ADRs
- read-first order
- stale index warnings if applicable

### UC3: Status/diagnostics

User asks whether the repo is indexed.

Tool returns:

- approved/not approved
- DB location
- last index time
- file/chunk counts
- stale/missing index warnings
- skipped file counts/reasons

## 9. V1 Scope

V1 includes:

1. Repo approval and safety boundary
2. Local registry + per-repo SQLite DB
3. Scanner with whitelist + blacklist + `.gitignore` support
4. Incremental indexing using hash/mtime
5. Chunker for code/Markdown/text
6. SQLite schema + raw SQL migrations
7. SQLite FTS5 tables
8. `codemap_index`
9. `codemap_search`
10. `codemap_context`
11. `codemap_status`
12. Minimal symbol extraction where cheap and reliable

V1 explicitly excludes:

- forced embeddings
- graph features
- ast-grep as a required dependency
- memory linking
- daemon or watcher
- background crawl across repos
- Prisma ORM

## 10. V1.5 / V2 Scope

Possible later additions:

- embedding provider interface
- FastEmbed/ONNX adapter
- `sqlite-vec`, Vec1, LanceDB, or external vector backend
- hybrid ranking via Reciprocal Rank Fusion
- ast-grep query-time integration
- stronger symbol extraction
- SQLite mini-graph
- test/doc relationship extraction
- memory artifact linking

## 11. Safety and Privacy Requirements

### Repo Boundary

The tool must only index explicitly approved Git repositories.

V1 must not:

- scan `$HOME`
- scan arbitrary parent folders
- auto-discover all repos
- run a global watcher
- index outside the current repo context

### Approval

First indexing requires explicit approval, e.g.:

```text
/codemap-index --approve-repo
```

Registry stores:

- repo root path
- repo hash
- git remote if available
- enabled flag
- approval timestamp
- approval source

### Symlinks

Default policy:

```text
Do not follow symlinks.
```

Future option: only follow symlinks whose resolved target remains inside repo root.

### File Inclusion

Default is whitelist-first.

Index common code, docs, and config files only:

- TS/JS
- Python
- Shell
- Go/Rust/Java/etc. later as simple text
- Markdown/MDX/RST/TXT
- JSON/YAML/TOML
- important config files

Default excludes:

- binaries
- images/videos/PDFs/archives
- lockfiles
- minified/bundled output
- dependency folders
- generated output
- coverage/build directories
- secret-like files

Default ignored patterns include:

```text
.git
node_modules
dist
build
.next
coverage
vendor
target
.idea
.vscode
*.lock
*.min.js
.env*
*.pem
*.key
*.crt
```

### Size Limits

Recommended defaults:

```text
max_file_size_default: 512 KB
max_file_size_code: 1 MB
max_file_size_docs: 1 MB
max_file_size_absolute: 2 MB
```

Files above the limit are skipped and counted in status output.

## 12. Data Storage

Use local per-repo SQLite databases plus a global registry:

```text
~/.pi/agent/codemap/
  registry.sqlite
  repos/
    <repo-hash>.sqlite
```

Rationale:

- simple cleanup per repo
- less locking contention
- easier debugging
- avoids committing DBs into repos
- keeps registry separate from index content

## 13. Database Design

Use:

```text
better-sqlite3 + raw SQL migrations
```

Do not use Prisma.

Core tables:

```sql
repos(
  id,
  root_path,
  git_remote,
  created_at,
  updated_at
);

files(
  id,
  repo_id,
  path,
  basename,
  language,
  size,
  hash,
  mtime,
  indexed_at
);

chunks(
  id,
  file_id,
  ordinal,
  start_line,
  end_line,
  kind,
  text,
  hash,
  token_estimate
);

symbols(
  id,
  file_id,
  name,
  kind,
  start_line,
  end_line,
  signature,
  parent_symbol_id,
  export_kind
);

index_runs(
  id,
  repo_id,
  started_at,
  finished_at,
  status,
  files_seen,
  files_changed,
  error
);
```

FTS tables:

```sql
files_fts(path, basename, language);
symbols_fts(name, signature, kind);
chunks_fts(text, path, language, kind);
```

Important constraints:

```sql
UNIQUE(repo_id, path);
UNIQUE(file_id, ordinal);
UNIQUE(file_id, name, kind, start_line);
```

## 14. Tool API

### `codemap_status`

Returns index health and repo approval state.

Output should include:

- repo root
- approved/enabled status
- DB path
- last index run
- file/chunk/symbol counts
- stale status
- skipped file counts by reason

### `codemap_index`

Indexes or updates current repo.

Inputs:

```ts
{
  approveRepo?: boolean;
  force?: boolean;
  policy?: "if_missing" | "if_stale" | "always";
}
```

### `codemap_search`

Searches paths, chunks, and symbols.

Inputs:

```ts
{
  query: string;
  limit?: number;
  includeDocs?: boolean;
  includeTests?: boolean;
}
```

Output item contract:

```ts
{
  path: string;
  startLine: number;
  endLine: number;
  kind: "file" | "chunk" | "symbol" | "doc" | "test";
  snippet: string;
  score: number;
  matchedBy: Array<"path" | "fts" | "symbol" | "heading">;
  warnings?: string[];
}
```

### `codemap_context`

Builds compact context for a file, symbol, or query.

Inputs:

```ts
{
  path?: string;
  symbol?: string;
  query?: string;
  budgetLines?: number;
  budgetChars?: number;
  includeTests?: boolean;
  includeDocs?: boolean;
}
```

Output:

```ts
{
  readFirst: ContextItem[];
  relatedTests: ContextItem[];
  relatedDocs: ContextItem[];
  warnings: string[];
}
```

## 15. Ranking

V1 ranking signals:

1. Exact path/name match
2. Symbol match
3. FTS chunk match
4. Markdown heading/doc match
5. Test-file boost if query mentions test/debug/failing
6. Small recency boost only

Embeddings are not part of V1 ranking.

## 16. Commands

Recommended commands:

```text
/codemap-status
/codemap-index
/codemap-search <query>
/codemap-context <path-or-symbol>
```

## 17. Packaging

The project should be packaged as a Pi extension/package.

Recommended structure:

```text
pi-ext-codemap/
  README.md
  PRD.md
  docs/
    adr/
      001-memory-vs-codemap.md
      002-local-index-safety.md
  migrations/
    001_init.sql
    002_fts.sql
  src/
    core/
      db/
        connection.ts
        migrate.ts
        queries.ts
        searchSql.ts
      scanner.ts
      ignore.ts
      chunker.ts
      indexer.ts
      search.ts
      ranking.ts
      context.ts
      symbols.ts
    pi-extension/
      index.ts
      tools.ts
      commands.ts
  package.json
```

## 18. Success Metrics

V1 is successful if:

- A repo can be approved and indexed locally.
- Indexing skips unsafe/irrelevant files by default.
- Search returns useful path/chunk/snippet results.
- Context output gives agents a better read-first set than raw `rg`.
- Results include line ranges and truncation-safe snippets.
- Status clearly reports stale/missing/unsafe index states.
- No daemon, remote service, or embedding runtime is required.

## 19. Implementation Decisions

- Build a Pi extension/package with four V1 tools: status, index, search, and context.
- Keep V1 local-only, on-demand, and explicitly approved per repository.
- Use a global registry plus one SQLite database per approved repo.
- Use `better-sqlite3` with raw SQL migrations; do not introduce Prisma.
- Use SQLite FTS5 as the primary V1 search engine across file paths, symbols, and chunks.
- Keep indexing incremental with file hash/mtime checks and deleted-file cleanup.
- Use whitelist-first scanning, `.gitignore` support, size limits, and conservative secret/binary/generated-file exclusions.
- Do not follow symlinks in V1.
- Chunk code, Markdown, and text into line-bounded ranges with stable ordinals and token estimates.
- Implement only cheap, reliable symbol extraction in V1; defer full AST/callgraph behavior.
- Rank by exact path/name, symbol matches, FTS matches, docs/headings, test intent, and small recency boosts.
- Return warnings instead of silently auto-refreshing stale indexes.
- Treat embeddings, ast-grep, graph relationships, and memory artifact linking as V1.5/V2 work.

## 20. Testing Decisions

- Tests should assert external behavior and contracts: indexed files, skipped files, tool outputs, warnings, and ranking order for representative cases.
- Scanner tests should cover allowlists, default excludes, `.gitignore`, size limits, symlinks, deleted files, and secret-like files.
- Migration/database tests should cover schema creation, FTS table availability, uniqueness constraints, and repeatable migration runs.
- Indexer tests should cover first indexing, incremental no-op indexing, changed files, deleted files, and failed runs.
- Chunker tests should cover code, Markdown headings, plain text, line ranges, overlap/default sizing, and truncation-safe snippets.
- Search tests should cover path matches, symbol matches, FTS chunk matches, doc matches, test boosts, limits, and empty results.
- Context tests should cover read-first ordering, related tests/docs inclusion, budget limits, stale warnings, and missing target behavior.
- Safety tests should verify unapproved repos cannot be indexed and paths outside the repo root are rejected.
- Package/integration tests should verify the Pi extension loads and each V1 tool validates inputs and returns the documented contract.

## 21. MVP Build Order

1. README + ADR-001
2. Package skeleton + Pi extension loads
3. Registry + per-repo DB path handling
4. SQLite schema + migrations
5. Scanner with approval/ignore/safety rules
6. Hash/mtime incremental indexing
7. Chunker for code/Markdown/text
8. FTS5 tables and indexing
9. `codemap_status`
10. `codemap_index`
11. `codemap_search`
12. `codemap_context`
13. Minimal symbol extraction
14. Tests/docs heuristics
15. Optional V1.5 features

## 22. Open Questions

Before implementation:

- Exact Pi extension manifest shape.
- Whether V1 exposes 4 tools or one `codebase` tool with actions.
- Initial language whitelist details.
- Exact chunk size and overlap defaults.
- Whether stale index should auto-refresh for approved repos or only warn.

Recommended defaults:

- 4 small tools for V1.
- manual/on-demand indexing only.
- stale search warns instead of silently reindexing.
- no symlink following.
- no embeddings in V1.
