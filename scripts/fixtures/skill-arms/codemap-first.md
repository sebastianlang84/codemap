---
name: navigating-with-codemap
description: Start code navigation in this repository with the CodeMap CLI, a local ranked index of the repository, before rg, grep, or find, to locate the files and line ranges to read. Not for log searches, exhaustive literal/regex matches, or reading an already-known file.
---

# Navigating with CodeMap

CodeMap is a local index of a repository. `search` ranks files, symbols, and code chunks for a
query; `context` returns a read-first plan for a target — its imports, callers, tests, config, and
docs. It is deterministic and lexical: no embeddings, no network, nothing leaves the machine.

## Workflow

Begin navigation with these steps before any rg, grep, or find.

1. Check `codemap status --json` unless readiness is already known. If stale, refresh the approved index with `codemap index`.
2. When ready, run `codemap search "<task terms>" --json`.
3. Pass a trusted hit location to `codemap context "<path>:<start>-<end>" --json --limit 1` for its source. Symbols or the original query also work; plain paths start at the file header. Increase the limit only for related context.
4. Re-query once with concrete terms, then fall back if results remain weak.

Query with the task's most specific words — symbol names, path fragments, domain terms, error or
header names — not with a full sentence; ranking is lexical.

## When it does not fit

Use exhaustive search for every literal/regex match, logs, or non-code config. Read known files
directly; use `ast-grep` for code-shape queries. Fall back when CodeMap is unavailable or not ready.
Never run `codemap index --approve` without user approval.

Search and context return ranked, bounded results, not an exhaustive list of references or callers.
Symbols come from cheap parsing and relations from import text, so dynamic dispatch,
generated code, and exotic path aliases are missed.
