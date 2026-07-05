# CodeMap

**A fast, local, deterministic map of a repository — so a coding agent finds the right files before it reads or edits them.**

CodeMap indexes code and plain-text project files into a local SQLite/FTS database. An agent then asks *"where is this feature/symbol/endpoint/config, and what should I read first?"* and gets a ranked answer plus the related files (imports, callers, tests, docs, config) — instead of running many broad `grep`/`find` passes and reading whole files to orient itself.

It runs anywhere a coding agent can run a shell command: as a **Pi extension** (tools + slash commands) or as a **standalone `codemap` CLI** for Claude Code, Codex, Cursor, or any shell-driven agent.

## Why it's worth using

- **Cheaper, sharper navigation than raw grep.** One ranked query replaces several `grep`/`find` passes and speculative full-file reads. For an LLM agent that directly means fewer tool calls and fewer tokens spent just finding where to work.
- **Read-first context, not just hits.** For a target file CodeMap returns its imports, reverse-imports/callers, C/C++ header↔source pairs, nearby config, sibling tests, and related docs — the neighborhood you'd otherwise reconstruct by hand.
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
- **Not a file reader or editor.** It tells you *where to look*; you still open and edit files with your normal tools. Treat its context as a read-first list, not a substitute for reading.
- **Not a memory system.** It indexes rebuildable repo state. Durable decisions and handoffs belong in `pi-memory`.
- **Not auto-refreshing.** You re-index after changes; it warns when stale rather than watching the tree in the background.

```text
pi-memory stores durable decisions and handoffs.
CodeMap indexes the current (rebuildable) repo state and helps you navigate it.
```

## Install

### As a standalone CLI (Claude Code, Codex, any shell agent)

Requires **Node ≥ 24** (CodeMap uses the built-in `node:sqlite` and runs TypeScript directly — no build step).

```bash
# Installs a `codemap` command on your PATH
npm install -g github:sebastianlang84/pi-ext-codemap

# …or from a local clone
git clone https://github.com/sebastianlang84/pi-ext-codemap
cd pi-ext-codemap && npm link
```

Then, inside any Git repository:

```bash
codemap index --approve         # one-time: approve + build the local index
codemap search auth middleware  # ranked files/symbols/chunks
codemap context src/app/auth.ts # read-first files + related tests/docs/imports
codemap status                  # approval / index / staleness (add --json anywhere)
```

**Wire it into an agent.** Add a note to the repo's `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex) so the agent reaches for CodeMap before grepping:

```markdown
## Code navigation
Prefer CodeMap over raw grep/find to locate code in this repo:
- `codemap search <terms>` — ranked files, symbols, and chunks
- `codemap context <path|query>` — read-first files plus related tests/docs/imports
Run `codemap index --approve` once, then `codemap index` to refresh after changes.
Use `--json` when you want to parse results. Staleness is advisory.
```

Everything is local-only and never leaves your machine; the first index requires `--approve`.

### As a Pi extension

```bash
pi install git:github.com/sebastianlang84/pi-ext-codemap
# local development:
cd /path/to/pi-ext-codemap && pi install .
```

Then use the `/codemap-*` slash commands and `codemap_*` tools — see the [Pi quick start](#pi-quick-start).

## CLI reference

All commands default to the current directory and accept `--json`, `--repo <path>` (target another repo), and `--path-prefix <dir>` (scope to a subtree).

| Command | Purpose |
|---|---|
| `codemap search <query> [--limit N]` | Ranked paths, symbols, and chunks. |
| `codemap context <path\|query> [--limit N]` | Read-first target file plus related imports, callers, tests, docs, config. |
| `codemap status [--full]` | Approval, index counts, and staleness (`--full` does a working-tree scan). |
| `codemap index [--approve]` | Build or refresh the index (`--approve` required the first time). |

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

**Strengths:** fast lexical/FTS search; symbol-aware for TypeScript, JavaScript, Python, C, and C++; relationship-aware read-first context; deterministic and reproducible; zero infrastructure and a tiny dependency footprint; monorepo scoping and cross-repo targeting; explicit stale-index warnings.

**Limitations:** no semantic/NL search; heuristic (non-AST) symbols and relationships; language support is tiered (C/C++ have symbols but not yet structured chunking; many languages are indexed as text only); manual re-index; per-repo approval and Node ≥ 24 required.

The full, current capability list lives in [`docs/user/usage.md`](docs/user/usage.md).

## Documentation map

- [`docs/user/usage.md`](docs/user/usage.md) — features, workflows, commands/tools, examples, compatibility.
- [`docs/product/PRD.md`](docs/product/PRD.md) — product contract, scope, goals, constraints, success metrics.
- [`docs/product/roadmap.md`](docs/product/roadmap.md) — future/non-V1 ideas, deferred questions, delivery history.
- [`docs/developer/architecture.md`](docs/developer/architecture.md) — storage, schema, scanner/index/search/context architecture, adapter boundary, testing policy.
- [`docs/developer/search-quality.md`](docs/developer/search-quality.md) — maintainer notes for ranking/search-quality benchmark usage.
- [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) — deterministic eval comparing lexical, search-only, and search-plus-context navigation.
- [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) — local real-repo eval measuring navigation value against rg-like lexical baselines.
- [`docs/developer/qmd-research.md`](docs/developer/qmd-research.md) — prior-art notes from `tobi/qmd` and implications for chunking, vector search, models, and lightweight defaults.
- [`docs/archive/brainstorming.md`](docs/archive/brainstorming.md) — original historical brainstorming note, no longer authoritative.

## License

MIT, as declared in `package.json`.
