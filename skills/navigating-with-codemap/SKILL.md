---
name: navigating-with-codemap
description: Locate repository implementations, symbols, imports, callers, and tests with the CodeMap CLI. Use before grep, rg (ripgrep), find, fd, glob, or broad file search for code navigation. Not for log searches, exhaustive literal/regex matches, or reading an already-known file.
---

# Navigating with CodeMap

## Workflow

1. Check `codemap status --json` unless readiness is already known. If stale, refresh the approved index with `codemap index`.
2. When ready, run `codemap search "<task terms>" --json`.
3. For matched code, run `codemap context "<symbol or original query>" --json`. For file relationships, use `codemap context "<trusted-hit-path>" --json`; path targets start at the file header.
4. Re-query once with concrete terms, then fall back if results remain weak.

Use exhaustive search for every literal/regex match, logs, or non-code config. Read known files directly;
use `ast-grep` for code-shape queries. Fall back when CodeMap is unavailable or not ready.
Never run `codemap index --approve` without user approval. Search and context return ranked,
bounded results, not an exhaustive list of references or callers.
