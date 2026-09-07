# CodeMap

**Local, deterministic repository navigation for coding agents.**

CodeMap indexes code and plain-text project files into a local SQLite/FTS database. The CLI returns ranked files, symbols, code chunks, and related imports, tests, docs, and configuration.

The **standalone `codemap` CLI is the primary interface**. The same operations are also available through a native MCP server (Claude Code, Codex, Cursor, or any MCP host) and an optional Pi extension (tools + slash commands).

## Why it's worth using

- **Ranked navigation.** Search by symbol, path fragment, or task terms. Lower agent token use and better task completion are evaluation goals, not established general benefits.
- **Read-first context, not just hits.** For a target file CodeMap returns its imports, reverse imports, C/C++ header↔source pairs, nearby config, sibling tests, and related docs.
- **Deterministic and private.** No embeddings, no model downloads, no daemon, no network. The same query gives the same ranked result, and repository content never leaves your machine.
- **Honest about freshness.** It flags when the index has drifted from the working tree instead of silently returning stale results.

## What CodeMap is for

- Orienting in an unfamiliar or large repository.
- "Where is this feature / symbol / endpoint / config key / script implemented?"
- "Which file should I read first before I change this one, and what's related to it?"
- Cutting the grep-and-read token cost an agent pays before it can start real work.
- Local, offline, privacy-sensitive work where sending code to a remote index is not acceptable.

## What CodeMap is *not*

- **Not semantic search.** V1 ranking is lexical/FTS + local heuristics. Query with real tokens (symbol names, path fragments, feature words), not vague natural-language questions. No embeddings or conceptual-similarity matching.
- **Not a compiler-accurate index.** Symbols come from cheap regexes and relationships from import/include text matching — not a full AST or call graph. It will miss dynamic dispatch, macro-generated code, and exotic path aliases.
- **Bounded context, no editing.** It returns selected excerpts and related paths. Use normal file tools for complete source and edits.
- **Not a memory system.** It indexes rebuildable repository state; keep durable decisions in your project documentation or agent memory.
- **Not auto-refreshing.** You re-index after changes; it warns when stale rather than watching the tree in the background.

## Evidence and limits

- **External navigation holdout, 2026-08-25:** 40 changes across six repositories, with a five-file budget. The evaluated CodeMap profile found all expected paths in 42.5% of cases versus 25.0% for the lexical baseline, using 74.2% fewer estimated read tokens. These are scripted navigation results; the paired success difference was not significant at 0.05. [Method and results](docs/developer/external-holdout.md).
- **Agent pilot:** on 12 coding tasks, CodeMap produced 0 paired wins, 1 loss, and 11 ties, using 16.4% more tokens. The subsequent retrieval-fix follow-up did not confirm a task-success benefit. [Agent-impact evaluation](docs/developer/agent-impact-eval.md).
- **Fresh agent follow-up, 2026-09-06:** four tasks produced the same 3/4 successes with and without CodeMap, with 39.7% more tokens and 8.5% more agent time for CodeMap. The predeclared product criteria were not met. [Completed results](docs/developer/agent-impact-eval.md#frozen-excerpt-workflow-pilot).
- **Luna-high comparisons:** [Optional availability](docs/developer/agent-impact-luna-result.md) solved 8/8 in both arms with no CodeMap use. The [location-first follow-up](docs/developer/agent-impact-location-result.md) solved 4/4 versus baseline 3/4, with 17.0% less agent time and 4.7% more total tokens. Its token-reduction gate failed; one paired win does not establish general benefit.
- **Local regression snapshot, 2026-09-06:** 24 navigation cases retain 7 wins, 0 losses, and 17 ties versus search-only. Query context now preserves matched code excerpts; JavaScript/Python gates check the required lines and function content. These checks establish navigation and excerpt correctness; the agent follow-up does not isolate the excerpt fix.

Maintainer evaluations run from a source checkout:

```bash
npm run verify:local                   # tests and deterministic quality gates
npm run eval:external-holdout:gate     # downloads/caches pinned historical snapshots
```

## Install

### Standalone CLI (recommended)

Use a Node.js version satisfying [`engines.node` in package.json](package.json). CodeMap uses the built-in `node:sqlite`.

```bash
# Install the current main branch
npm install -g github:sebastianlang84/codemap

# …or link a development checkout
git clone https://github.com/sebastianlang84/codemap ~/dev/codemap
cd ~/dev/codemap
npm install && npm run build && npm link
```

For a pinned installation, select an existing [release tag](https://github.com/sebastianlang84/codemap/tags).

Then, inside any Git repository:

```bash
codemap index --approve         # one-time: approve + build the local index
codemap search auth middleware  # ranked files/symbols/chunks
codemap context src/app/auth.ts:42 --json # preserve a trusted search location
codemap context src/app/auth.ts # read-first files + related tests/docs/imports
codemap context "where auth tokens are refreshed" # fused query-driven read plan
codemap status                  # approval / index / staleness (add --json anywhere)
codemap usage-report            # aggregate local adoption and navigation signals
```

Indexing and navigation run locally. The first index requires user approval via `--approve`;
refresh an approved index after changes with `codemap index`.

### Agent skill for CLI discovery

The package includes [`navigating-with-codemap`](skills/navigating-with-codemap/SKILL.md).
Its frontmatter names `grep`, `rg`/ripgrep, `find`, `fd`, and glob searches for code navigation.
The workflow covers readiness, search, context, stale-index refresh, and exhaustive-search fallbacks.

**Installing the CLI does not activate the skill.** Copy or symlink only its directory into your
agent's global or repository-local skill discovery directory. From this checkout, for example:

```bash
# Replace the destination with your agent's actual skill discovery directory.
cp -R skills/navigating-with-codemap /path/to/agent/skills/
```

For a global npm installation, the source directory is
`$(npm root -g)/@sebastianlang84/codemap/skills/navigating-with-codemap`.
See the [deployment guide](docs/user/agent-skill.md) for copying, symlinking, and updates.
The agent must discover the skill; trigger wording alone cannot guarantee that it loads.

### As an MCP server (native tools in Claude Code, Codex, Cursor)

The package also provides `codemap-mcp`, a stdio MCP server exposing `codemap_status`,
`codemap_search`, `codemap_context`, and `codemap_index`. Register it in your MCP host to expose
native tools instead of CLI commands.

For hosts whose configuration uses `mcpServers`:

```json
{
  "mcpServers": {
    "codemap": { "command": "codemap-mcp" }
  }
}
```

Launch the server in the target repository, or pass `repoPath` in tool calls. First-time indexing
requires user approval and `approveRepo: true`. MCP registration is optional; the CLI and bundled
skill work independently of it.

### As a Pi extension

```bash
pi install git:github.com/sebastianlang84/codemap
# local development:
pi install ~/dev/codemap
```

Then use the `/codemap-*` slash commands and `codemap_*` tools — see the [Pi quick start](#pi-quick-start).

Upgrading from `pi-ext-codemap` or moving an existing local installation? Follow the [migration guide](docs/user/migrating-from-pi-extension.md) for the Git source, Pi package, development checkout, and state directory.

## CLI reference

The four navigation commands default to the current directory and accept `--json`, `--repo <path>` (target another repo), `--path-prefix <dir>` (scope to a subtree), and `--state-dir <path>` (override where indexes and the approval registry are stored).

| Command | Purpose |
|---|---|
| `codemap search <query> [--limit N]` | Ranked paths, symbols, and chunks. |
| `codemap context <path\|query> [--limit N]` | Matched code excerpts for queries; file relationships for paths. |
| `codemap status [--full]` | Approval, index counts, and staleness (`--full` does a working-tree scan). |
| `codemap index [--approve]` | Build or refresh the index (`--approve` required the first time). |
| `codemap usage-report [--since YYYY-MM-DD] [--window N]` | Aggregate local usage, activation, freshness, and search→context signals without exposing raw telemetry fields. |

### State location

State resolution is `--state-dir` → `CODEMAP_HOME` → `$XDG_DATA_HOME/codemap` → `~/.local/share/codemap`. Existing users keep using `~/.pi/agent/state/codemap` automatically when no environment override is set, that legacy directory exists, and the new default does not. See the [migration guide](docs/user/migrating-from-pi-extension.md#move-state-to-the-platform-neutral-location) before moving it; do not merge SQLite directories by hand. A source checkout also provides `npm run gc:state` to prune indexes for repositories that no longer exist.

## Pi quick start

```text
/codemap-index --approve-repo                         # approve + index this repo
/codemap-status --full                                # health before trusting old results
/codemap-search memory handoff retrieval              # find files/symbols/chunks
/codemap-search --path-prefix services/api auth       # scope to a monorepo subtree
/codemap-context src/core/search.ts                   # read-first package for a file
/codemap-search --repo-path /path/to/repo auth        # target another repo
```

## Strengths and limitations at a glance

**Strengths:** ranked lexical/FTS search; symbol-aware for TypeScript, JavaScript, Python, C/C++, Go, Rust, Java, Kotlin, Ruby, and PHP; relationship-aware read-first context; deterministic and reproducible; zero infrastructure and a tiny dependency footprint; monorepo scoping and cross-repo targeting; explicit stale-index warnings.

**Limitations:** no semantic/NL search; heuristic (non-AST) symbols and relationships; language support is tiered (only TypeScript/JavaScript/Python have structured code chunking); manual re-index; per-repo approval and a compatible Node.js runtime required.

The full, current capability list lives in [`docs/user/usage.md`](docs/user/usage.md).

## Documentation map

- [`docs/user/usage.md`](docs/user/usage.md) — features, workflows, commands/tools, examples, compatibility.
- [`docs/user/agent-skill.md`](docs/user/agent-skill.md) — install and update the bundled CLI navigation skill.
- [`docs/user/migrating-from-pi-extension.md`](docs/user/migrating-from-pi-extension.md) — upgrade existing Git, npm, Pi, local-development, and state installations.
- [`docs/product/PRD.md`](docs/product/PRD.md) — product contract, scope, goals, constraints, success metrics.
- [`docs/product/roadmap.md`](docs/product/roadmap.md) — future/non-V1 ideas, deferred questions, delivery history.
- [`docs/developer/architecture.md`](docs/developer/architecture.md) — storage, schema, scanner/index/search/context architecture, adapter boundary, testing policy.
- [`docs/developer/search-quality.md`](docs/developer/search-quality.md) — maintainer notes for ranking/search-quality benchmark usage.
- [`docs/developer/external-holdout.md`](docs/developer/external-holdout.md) — frozen public-repo holdout method, first-run evidence, and claim limits.
- [`docs/developer/agent-impact-eval.md`](docs/developer/agent-impact-eval.md) — coding-task results and current limits.
- [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) — deterministic eval comparing lexical, search-only, and search-plus-context navigation.
- [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) — local real-repo eval measuring navigation value against rg-like lexical baselines.
- [`docs/developer/qmd-research.md`](docs/developer/qmd-research.md) — prior-art notes from `tobi/qmd` and implications for chunking, vector search, models, and lightweight defaults.
- [`docs/archive/brainstorming.md`](docs/archive/brainstorming.md) — original historical brainstorming note, no longer authoritative.

## License

MIT, as declared in `package.json`.
