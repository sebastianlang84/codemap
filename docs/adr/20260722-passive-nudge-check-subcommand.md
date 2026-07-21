# ADR 20260722 — Passive `codemap nudge-check` subcommand

- **Status:** Proposed (tool only; no activation)
- **Date:** 2026-07-22

## Context

The grep/rg/find navigation heuristic (`shouldNudgeForCodeMapNavigationCommand`) was wired only into
the Pi adapter's `tool_result` hook, so the other surfaces — including Claude Code, where all three
logged adoption incidents occurred (see [`TODO.md`](../../TODO.md) and the `codemap-adoption-friction`
memory) — could not reuse it. The heuristic itself is pure and harness-neutral.

[ADR 20260718](20260718-grep-fallback-enforcement-gate.md) **rejected** a `PreToolUse` deny gate:
its cross-repo blast radius, runtime-specific behavior, and interference with legitimate fallback
searches outweighed deterministic enforcement. That rejection stands.

## Decision

Ship the heuristic as a **passive** CLI subcommand, and nothing more:

- `codemap nudge-check '<command>'` moves the heuristic to `src/core/bash-nudge.ts` (shared by the Pi
  hook and the CLI) and exposes it as: **exit 1** with a one-line hint on stdout when the command is a
  broad grep/rg/find **and** `status` reports the repo `ready` and not `stale`; **exit 0** (silent)
  otherwise; **exit 2** for a usage error.
- **Fail-open and non-blocking by construction:** not-a-broad-search, not-indexed, stale, or any error
  all yield exit 0 with no output. It reads readiness via core `status()` directly (not the telemetry
  seam), so an intercepted grep does not spam `usage.jsonl`.
- **No hook is wired.** This ADR ships the *tool*. Activating it in any harness (e.g. a Claude Code
  `PostToolUse` script that surfaces the hint as advisory context and always exits 0) is a **separate,
  deliberate decision** and must not reintroduce blocking — the deny gate remains rejected.

## Consequences

- **Opt-in, low blast radius:** nothing changes until a user wires the subcommand into a hook. Pi
  behavior is byte-identical (same heuristic, same text, same readiness gate) after the module move.
- **Closes the measurement gap only once activated + instrumented:** ADR 0001's `usage.jsonl` "cannot
  observe sessions that use only another search tool." A future `nudge_check` telemetry event (a
  documented follow-up, intentionally not built here) would make grep-fallback moments observable for
  the first time. Until a hook is wired, the subcommand emits no telemetry.
- **Reversible:** removing the subcommand and reverting the module move restores the prior state.

## Follow-ups (not in this change)

- A harness hook wrapper + its own activation decision.
- A `nudge_check` telemetry event to quantify grep-fallback frequency.
- Optional dedupe/cooldown (the CLI is process-stateless; the Pi hook dedupes per session).
