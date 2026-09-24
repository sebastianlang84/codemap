---
name: navigating-with-codemap
description: Optionally preselect files and line ranges with the CodeMap CLI, a local ranked index of the repository, when the target file or symbol is unknown and a first rg search gives too many or no useful hits. Not for log searches, exhaustive literal/regex matches, or reading an already-known file.
---

# Navigating with CodeMap

CodeMap is a local index of a repository. `search` ranks files, symbols, and code chunks for a
query; `context` returns a read-first plan for a target — its imports, callers, tests, config, and
docs. It is deterministic and lexical: no embeddings, no network, nothing leaves the machine.

## Workflow

1. Run `codemap search "<task terms>" --json`. Its output flags a stale index; only then refresh the approved index with `codemap index`.
2. Read a trusted hit with `codemap context "<path>:<start>-<end>" --json --limit 1`. Put the file reads you already know you need into the same shell command.
3. An excerpt is the current source of its lines: do not read those lines again, read only what it leaves out.
4. Re-query once with concrete terms, then fall back to `rg` if results remain weak.

Query with real tokens — symbol names, path fragments, endpoint strings, config keys — not with a
descriptive phrase; ranking is lexical.

## When it does not fit

Use exhaustive search for every literal/regex match, logs, or non-code config. Read known files
directly; use `ast-grep` for code-shape queries. Fall back when CodeMap is unavailable or not ready.
Never run `codemap index --approve` without user approval.

Search and context return ranked, bounded results, not an exhaustive list of references or callers.
Symbols come from cheap parsing and relations from import text, so dynamic dispatch,
generated code, and exotic path aliases are missed.
