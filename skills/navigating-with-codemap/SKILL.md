---
name: navigating-with-codemap
description: Use for codebase navigation and before grep, rg, find, fd, glob, or broad file search for implementations, symbols, callers, tests, or related files. Load this skill before running those fallback commands. Start with CodeMap when ready; use exhaustive search for literal/regex scans and CodeMap misses.
---

# Navigating with CodeMap

CodeMap ranks files, symbols, and code chunks; `context` adds likely imports, callers, tests,
config, and docs. This means fewer speculative reads. `grep`/`find` return literal matches without
a read-first plan.

## Workflow

1. Run `codemap status --json`.
2. If ready, run `codemap search "<task terms>" --json`.
3. Run `codemap context <trusted-hit> --json`.
4. Re-query once with concrete terms, then fall back if results remain weak.

Use exhaustive search for every literal/regex match, logs, non-code config, known paths, or when
CodeMap is unavailable or not ready. Never run `codemap index --approve` without user approval.
