# ADR 20260729 — Skip nested git worktrees when indexing

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

A git worktree created *inside* a repository is a complete second checkout of the same tree. Indexing
it duplicates every symbol and every document, and both copies score nearly identically, so each
search returns each hit twice. Observed 2026-07-26 in `~/pi-dev/pi-ext-auth`, where an agent created
`.claude/worktrees/hungry-chatelet-2b3eb9/`: `codemap index --approve` indexed 64 files — both copies —
and every result list from then on was half as informative. `codemap context` pulled the duplicates up
as `related_doc` as well.

Reproduced in a throwaway repository (one symbol, one README, plus `git worktree add
.claude/worktrees/x`): 4 files indexed instead of 2, and

```
src/auth.ts:1 [function] registerCurated — 95.36
.claude/worktrees/x/src/auth.ts:1 [function] registerCurated — 95.26
README.md:1-3 [markdown] # wt-repo — 34.99
.claude/worktrees/x/README.md:1-3 [markdown] # wt-repo — 34.90
```

The near-tie between the two copies also degraded the top hit to `confidence: low`, so the duplication
cost ranking confidence on top of list length.

The existing exclusion never applied: [`ignore.ts`](../../src/core/ignore.ts) lists `.git` as an
ignored **directory**, but inside a worktree `.git` is a **file** pointing at the main repository.
Nothing in `ignoredDirs` covers worktree locations, and `.claude/` is not in most repositories'
`.gitignore`.

## Decision

**Skip nested worktrees at index time**, detected via `git worktree list --porcelain`.

Detection lives in [`scan-policy.ts`](../../src/core/scan-policy.ts) — the layer that composes what
gets scanned — as `parseNestedWorktrees` (pure, unit-tested) plus a `listNestedWorktrees` I/O wrapper
called once per scan. `createScanPolicy` skips a directory whose repo-relative path is a registered
worktree, with the reason `nested git worktree`; `ignore.ts` stays pure pattern matching.

**Why git and not "`.git` is a file":** a git **submodule** also has a `.git` file, but a submodule is
distinct code rather than a duplicate of this tree and must stay indexed. The same holds for an
unrelated repository that happens to sit inside the tree. The cheap filesystem test cannot tell them
apart and would silently drop both.

**Why not the alternatives:**

- *Separate indexes per worktree* needs no new mechanism: the index key is `hash(root)` and
  [`findRepoRoot`](../../src/core/repo.ts) resolves via `git rev-parse --show-toplevel`, which returns
  the worktree root when invoked inside one. A worktree already gets its own index the moment someone
  indexes from inside it. The only missing piece was keeping it out of the *main* index.
- *Collapsing duplicates at search time* treats the symptom: the scan cost, the index size and the
  `related_doc` duplication all remain, and a dedup heuristic in ranking is a riskier change than a
  traversal skip.

## Edge cases

- **Indexing from inside a worktree** (the worktree is the target, the main repository is the
  outsider): `parseNestedWorktrees` never returns the scanned root itself, and the main repository lies
  outside it and is therefore never traversed. Covered by a unit test.
- **Worktree outside the repository** (the normal case): not under the root, never visited, unchanged.
- **Stale index from before this change:** the skip does not mark the scan `incomplete`, so the
  deletion pass runs and a plain `codemap index` prunes the duplicates. Verified — the polluted
  throwaway index reported `Indexed 0/2 files (2 skipped, 2 removed)` and searches returned single
  hits at `confidence` restored to a clear top score.

## Class check

- **Symlinked directories inside the tree:** already skipped — [`scanner.ts`](../../src/core/scanner.ts)
  rejects every `isSymbolicLink()` entry before the policy runs.
- **`.pi/git` clones:** already in `ignoredDirs`.
- **Submodules:** deliberately still indexed (distinct code, see above), and the chosen detection keeps
  them so.
- **Nested independent repositories:** not duplicates of this tree; unchanged.

## Not in this change

The untracked worktree directory also makes `git status` report the tree dirty, and
[`index-health.ts`](../../src/core/index-health.ts) turns any dirty file into `stale: true` — measured
on the fixed throwaway repo: `stale: true` with `changed/missing/deleted = 0`, driven solely by
`?? .claude/`. This is **not** worktree-specific: untracked, never-indexed content of any kind
(`.claude/settings.json`, logs) triggers it identically, and the dirty signal cannot be attributed per
path because git folds an untracked directory into one entry (`?? .claude/`) unless `-uall` is passed,
which would change the reported dirty-file count everywhere. Narrowing the dirty signal to *indexed*
files is a separate slice with its own metric; `search` is unaffected because it uses the HEAD-based
`cheapIndexHealth`.
