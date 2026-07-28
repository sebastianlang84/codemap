# ADR 20260729 — Index staleness follows indexed files only

- **Status:** Accepted
- **Date:** 2026-07-29
- **Follows:** [ADR 20260729 — Skip nested git worktrees](20260729-nested-worktree-indexing.md), which scoped this out.

## Context

`fullIndexHealth` turned *any* dirty file into `stale: true`. Because `git status` reports untracked
content that codemap never indexes — a nested worktree, editor state, logs, build leftovers — a
repository could report a stale index permanently, and **no `codemap index` run could ever clear it**:
re-indexing changes nothing about content that is never scanned.

Measured on the throwaway repository from the worktree ADR, after that fix: `stale: true` with
`changed/missing/deleted = 0`, driven solely by `?? .claude/`. `codemap context` printed
`(!) index is stale for this query; run 'codemap index' to refresh` on every call, and running the
suggested command left it unchanged. That is the exact "advice that does not work" pattern
[`TODO.md`](../../TODO.md) records as a reason agents fall back to grep.

The problem is not worktree-specific: `.claude/settings.json`, a `logs/` directory, or any untracked
non-indexed file triggers it identically.

## Decision

Count only dirty paths the index actually covers. `fullIndexHealth` filters `git status` entries to
those present in the indexed-file map or in the current scan, and derives both `stale` and the
`Working tree dirty: N indexed file(s).` warning from that subset.

`dirty` and `dirtyFiles` keep reporting the **raw** git view, unfiltered — they answer "what does git
say about this tree", which is a different question from "is the index behind". Existing tests pin that
distinction (a pre-first-commit repo reports `dirty: true` with `stale: false`).

**Why filtering is safe rather than a blind spot:** file-level drift is already detected precisely by
the hash comparison in the same function. A file added under an untracked directory shows up as
`missing`, a removed one as `deleted`, an edited one as `changed`. The dirty signal only ever added
value for one case — a content edit that keeps size and rounded mtime identical, which the mtime+size
fastpath skips — and for an *indexed* file that case still marks the index stale, because such a file
passes the filter.

**Why not `git status -uall`:** git folds an untracked directory into a single entry (`?? .claude/`),
so per-path attribution needs `-uall`, which would change the reported dirty-file count on every
surface. Pathspec exclusion (`:(exclude)…`) does not help either — measured with git 2.39.2, the folded
directory entry survives it.

## Consequences

- A repository whose only dirty content is never indexed reports `stale: false` with no warnings, so
  `codemap context` stops emitting advice that cannot work. Verified end to end on the throwaway repo:
  `stale: false`, `warnings: []`, while `dirty: true` and `dirtyFiles: ["?? .claude/"]` remain.
- Editing an indexed file still marks the index stale through the dirty signal, warning included.
- `search` is unaffected — it uses the HEAD-based `cheapIndexHealth`, which never read this signal.
- The warning text changed from `Working tree dirty: N files.` to `Working tree dirty: N indexed
  files.`, so it now states what it is actually about.
