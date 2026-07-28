# TODO

Aktive offene Arbeit für CodeMap. Erledigte Arbeit gehört in den [`CHANGELOG.md`](CHANGELOG.md), Eval-Befunde in die passenden Dokumente unter [`docs/developer/`](docs/developer/), Produkt-/Architekturkontext in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Nächster Slice

Kein aktiver Implementierungsslice. Weitere Konventions-/Targeting-Arbeit erst bei einem neuen konkreten Eval-Miss auswählen; pro Konvention ein Fixture oder Real-Repo-Case und eine eigene Metrik, keine breite Heuristik ohne messbaren Context-Gewinn.

## Opportunistisch oder gated

- [ ] Test-/Eval-Script-Deepening nur bei erneutem Doppel-Touch fortführen.
  - Gemeinsame Gate-Report-/CLI-Parser-Helfer erst extrahieren, wenn beide Navigation-Skripte erneut geändert werden.
  - Inline Eval-Cases nur dann in Datenmodule verschieben, wenn dadurch Logik- und Corpus-Diffs tatsächlich klarer werden.
  - Bestehende Core-Helfer und die bereits getrennten Search-/Navigation-Suites wiederverwenden; keine Pi/TUI-Adapterdetails in Core-Tests ziehen.

- [ ] Workspace-/Multi-Config-Pfadalias nur bei einem konkreten Miss angehen.
  - Minimaler `tsconfig.json`-/`jsconfig.json`-`baseUrl`- und `paths`-Support existiert; komplexe `extends`-Ketten, Workspace-Aliasse und Budget-Ordering bei vielen Alias-Imports bleiben bewusst offen.

- [ ] Strukturiertes C/C++-Chunking nur mit sprachspezifischem Scanner und Fixture-Beleg prüfen.
  - Symbole und kanonische `c`-/`cpp`-Tags sind umgesetzt. Fixed-Window-Chunking bleibt, weil der JS/TS-Brace-Scanner bei C-`/`-Division fehlzünden kann.
  - Anonyme `typedef struct { … } Name;` und Makros nur bei einem konkreten Miss ergänzen.

- **Doc-Flood-Ranking-Fix gelandet (2026-07-15, ADR [`docs/adr/20260714-search-code-vs-doc-target.md`](docs/adr/20260714-search-code-vs-doc-target.md)):** konzeptuelle/UI-Queries lieferten READMEs statt Code; behoben via Phantom-FTS-Entfernung, doc-evidence-gated `overview`-Intent, additiver Code-Quota + doc-intent-gated Code-Lift (keine Doc-Abwertung). Merge-Evidenz: `doc-flood`-Fixture + Ranking-Unit-Tests, `bench:search-quality:gate` grün (Vorher: Code aus Top-5 gedrängt → Nachher recall@5 1.0), Review ohne Correctness-Befund. Beim Merge mit `8a87197` (weak-symbol/coverage) reconciled und volles `verify` auf dem kombinierten Stand grün.
  - **Offene Restgrenzen (eigene Slices, nur bei konkretem Miss):** (1) Doc-Headings als Symbole erhalten `exactTermSymbol`-Boost, wenn ein Query-Term = Heading-Name — separater Verstärker, bewusst nicht angefasst; (2) exaktes Ziel-Component rankt in großen Repos nicht immer #1 (Prosa-Token/FTS-Tier-Bias) — voller Fix bräuchte Tier-/bm25-Arbeit (gated).

- [ ] Graphify-inspirierte öffentliche Tools nur nach wiederholtem Agent-Nutzen und Budgetentscheidung erwägen.
  - Interne Neighborhood-/Path-Diagnostics und `npm run report:architecture` existieren bereits.
  - `codemap_explain`, `codemap_path`, Symbol-Level-Reports oder breites Architektur-Ranking brauchen jeweils einen festen failing Eval-Case, Produktentscheidung und `npm run check:token-injection`.

- [ ] Review-Cleanup ohne Produktverhalten nur bei einem konkreten Review-Befund durchführen.
  - `codemap_context` und das Gesamtbudget liegen nahe am Token-Gate; neue Parameter, Guidelines oder öffentliche Tools brauchen eine explizite Budgetentscheidung.

## Discoverability: agents under-use codemap even when the rule mandates it

> **Resolved 2026-07-19:** the owner rejected the proposed global `PreToolUse` gate as too invasive
> and runtime-specific. CodeMap instead bundles an optional, harness-agnostic
> [`navigating-with-codemap`](skills/navigating-with-codemap/SKILL.md) skill with explicit fallback
> boundaries. Users deploy it by copy or symlink at the scope their infrastructure supports; see
> [`docs/user/agent-skill.md`](docs/user/agent-skill.md). The rejected hook research remains in
> [`docs/developer/adoption-enforcement.md`](docs/developer/adoption-enforcement.md) and
> [ADR 20260718](docs/adr/20260718-grep-fallback-enforcement-gate.md) for historical rationale.
>
> **Update 2026-07-19 (later, from a `~/partflow` Claude Code session):** the skill approach is now
> itself under test against an **AGENTS.md-only directive** — see *Incident 3* and *Test plan* below.
> The bundled skill remains shipped; on the owner's dev machine it is temporarily symlink-disabled to
> A/B the two frames.

**Logged:** 2026-07-18 (from a Claude Code session in `~/partflow`)

### Incident 1

An agent did an extended code-reconnaissance task (building an audit-lens skill: locating
build-readiness math, availability/reservation code, parsers, guard files across the repo) and
navigated almost entirely with `grep` + subagent `test -f`, **never** running `codemap search`
/ `codemap context` — despite:
- the global `AGENTS.md` explicitly stating codemap is the primary navigation tool
  ("`codemap search`, then `codemap context`, before find/grep"),
- the repo being indexed and ready (a `SessionStart` hook even printed "codemap index ready"),
- codemap being clearly the better fit (symbol-level lookup with `file:line`).

The user had to prompt "codemap was indexed — why do you never use it?" before it got used. When
finally run, one `codemap search` resolved the exact symbols (`computeBuildReadiness` →
`build-readiness.ts:71`, `canBuildValue`, `AvailabilityTab`) in a single call — confirming it would
have been faster from the start. Root cause was habit (grep reflex), not a codemap failure.

### Why this matters

The rule exists but does not *fire* at the moment of action. A `SessionStart` "index ready" line
and a line in `AGENTS.md` are both passive — they don't intercept the grep reflex when the agent is
mid-task. Discoverability, not capability, is the gap.

### Candidate directions (for maintainers to weigh — not prescriptive)

- **Point-of-use nudge:** when the harness/hook detects `grep`/`rg`/`find` on an indexed repo,
  surface a one-line reminder ("indexed — `codemap search <terms>` may be faster") rather than
  relying on session-start text the agent has scrolled past.
- **Make the SessionStart line actionable, not decorative:** include a ready-to-run example
  (`codemap search "<likely task terms>"`) instead of just "index ready".
- **Tool-description weighting:** if codemap is exposed as an MCP/tool, ensure its description
  frames it as *first* nav step for symbol/definition/caller lookup, so it out-competes generic
  search tools at selection time. (Balance against this repo's low-token-injection rule.)
- **Staleness ergonomics:** the index flagged `stale` after a release + new untracked files; a
  near-zero-friction auto-refresh (or a louder "run `codemap index`") would remove one more reason
  to fall back to grep.

The chosen low-risk response is the bundled skill above. Whether it improves adoption should be
judged from controlled navigation tasks and future concrete incidents; the local usage log alone
cannot observe sessions that never invoke CodeMap.

### Incident 2 — the rule dies at the delegation boundary (2026-07-18)

**Logged:** 2026-07-18 (from a second Claude Code session in `~/partflow`, a P1 inventory-race
diagnosis). Same phenomenon as Incident 1, but a distinct root cause worth logging separately.

**What happened.** The main agent judged the reconnaissance "non-trivial" and — following its
global rule "use sub-agents by default" — dispatched an `Explore` subagent to map the code path.
The subagent navigated entirely with `grep`/`glob`/`read` and **never** ran codemap. The main
agent itself also never ran codemap before delegating. The user again had to prompt ("did you use
codemap? if not, why?") before it was used. One `codemap search` then resolved the exact symbols
(`inventory.service`, `stock-change.ts`, the DTO, the api-client layer) in a single call.

**Root cause — different from Incident 1.** Incident 1 was a single agent's grep *habit*. This one
is a **delegation-propagation gap**: the codemap-first rule lives only in the *main* agent's context
(global `AGENTS.md`). When the main agent delegates the navigation to a subagent, the rule does not
travel with the delegation — it is not injected into the subagent's prompt, and the `Explore` agent
type is itself framed as a grep/glob "search agent" with no codemap awareness. So the agent offloaded
*exactly the activity the rule governs* (code navigation) onto a delegate that never received the
rule. The main agent would have had to manually copy the rule into the subagent prompt, and didn't.

There is a **rule-interaction** angle here: two global rules ("navigate with codemap first" and
"delegate recon to subagents by default") pull against each other, and the current resolution
silently drops the first. Any fix has to make the two compose, not compete.

**The cost was correctness, not just latency.** The grep-based recon produced a complete-looking
report that **missed two DB-level constraints** on `inventory_transactions` (an append-only
UPDATE/DELETE deny-trigger, and `chk_quantity_delta_nonzero` — a CHECK that rejects a zero delta at
the DB). `codemap search` surfaced the guard's migration + integration test in its top hits
immediately. Those constraints materially changed the design (a "set on-hand to N" no-op must be
caught *before* insert or the DB throws). So codemap under-use here didn't just cost time — the
grep path shipped a design-relevant omission that codemap's ranking would have caught up front.

**New candidate direction (in addition to Incident 1's list).**

- **Make the rule survive delegation.** The nudge/guidance must reach *subagents*, not only the
  top-level agent — e.g. the `Explore`/search agent type's own definition frames codemap as its
  first nav step, or the harness injects the codemap-first line into every code-search subagent's
  context the same way it reaches the main agent. A rule that only the orchestrator can see will
  keep dying every time recon is delegated (which the "subagents by default" rule makes the common
  case, not the exception).

### Incident 3 — recurrence: reflex holds even with the skill shipped (2026-07-19)

**Logged:** 2026-07-19 (a third Claude Code session in `~/partflow`, a frontend UI task).

**What happened.** Same grep reflex as Incidents 1–2, and it recurred *after* the bundled skill was
in place. For two textbook code-discovery lookups ("which test files reference `PageHeader`", "where
are the read-only references") the agent used `grep -rl` / `grep -rn`. It ran codemap **zero** times
and **never loaded the `navigating-with-codemap` skill** the whole session. The user again had to ask
"did you use codemap?" before it was acknowledged.

**Root cause — the skill's presence did not help.** The skill's frontmatter (name+description) sits
in the always-on primacy slot, exactly like the `AGENTS.md` rule — so it is *present* at decision
time, not "too late". It still did not fire. So the problem was never slot/timing; it is
**presence → action conversion**: an always-on line (in either home) does not, on its own, intercept
an ingrained intent→action mapping. The skill *body*'s recency (loads fresh when invoked) is real but
**downstream of invocation** — moot on the exact path that fails, because the missed step *is* the
decision to invoke.

### Test plan — A/B two soft frames for the same reflex (owner to judge)

Two advisory models (Fable) converged on: for a *reflex*, a **directive frame** ("Code lookup =
codemap; swap grep") likely converts better than a **menu-offer frame** (a skill description reads as
"available for…"), even though both occupy the same always-on slot. Unproven — it is a claim about
model psychology, so treat it as a hypothesis to measure, not settled.

- **Variant A (LIVE now — Fable's pick):** sharpened imperative rule in global `AGENTS.md`
  (`Code lookup = codemap search …`; grep = closed exception list + "no lookup too small"), env block
  trimmed, and the **skill symlink-disabled** on the owner's machine. Tests the directive frame alone.
  - Live state: `AGENTS.md` line ~44 + `codemap:` env block replaced (2026-07-19). Skill removed from
    the live set (source in `~/codemap/skills/` untouched; codemap's own evals still read it).
  - Reversal / re-enable skill: `ln -s ~/codemap/skills/navigating-with-codemap
    ~/.agents/skills/navigating-with-codemap && ln -s ../../.agents/skills/navigating-with-codemap
    ~/.claude/skills/navigating-with-codemap`.
- **Variant B (next test option — the owner's alternative to try):** invert the split. Carry the
  reflex nudge in the **skill frontmatter written as a directive** (not a menu description), and
  **strip the codemap entries from `AGENTS.md`** so the skill's primacy-slot description is the sole
  always-on nudge, with the body giving recency-delivered detail. Tests whether a directive-framed
  frontmatter can replace the AGENTS.md rule outright. (Everything is possible, incl. keeping both if
  each earns rent.)
- **Deciding signal (cheap, honest):** this is a solo single-user setup, so a formal parallel A/B is
  underpowered (can't run both at once; low N; self-priming). Prefer **instrumentation over a formal
  split**: scan session transcripts for `grep`/`rg`/`find`/Grep/Glob issued with an *identifier
  pattern* on a code lookup **not** preceded by a `codemap` call — that rate = the reflex-miss rate.
  Ship one variant, watch the rate, switch if it doesn't move.

## Produktentscheidungen / später

- [ ] npm-Registry-Veröffentlichung erst bei konkretem Nutzerbedarf entscheiden; bis dahin bleibt `npm install -g github:sebastianlang84/codemap` kanonisch.
- [ ] Native MCP-`roots`-Auflösung erst bei einem belegten Host-Miss ergänzen; `repoPath` bleibt der Fallback für Hosts mit falschem Prozess-cwd.
- [ ] Refresh-Automation erst wieder aufnehmen, wenn breitere Agent-Evals oder Praxisfälle zeigen, dass Agenten bestehende stale Warnungen übersehen.
