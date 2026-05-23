# TODO

Active offene Arbeit für `pi-ext-codemap`. Abgehakte Punkte werden hier gelöscht; release-relevante Historie steht im [`CHANGELOG.md`](CHANGELOG.md). Produkt-/Architekturkontext steht in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Active tactical backlog — reviewed order

Aktuell kein nächster Slice ausgewählt. Der V1.5 Relationship-Graph ist implementiert; Budget- und Context-Quality-Baselines sind in [`docs/developer/relationship-graph-plan.md`](docs/developer/relationship-graph-plan.md#v15-budget-baseline) / [`Context-Quality-Gate`](docs/developer/relationship-graph-plan.md#v15-context-quality-gate) dokumentiert. Weiterer Graph-Ausbau bleibt gated: kein Symbol-/Docs-/Config-/Heuristik-/Search-Ranking-Ausbau ohne klaren Context-Gewinn und neue Budget-Entscheidung.

Refresh-Automation bleibt nach dem Agent-Refresh-Eval bewusst zurückgestellt; siehe [`docs/developer/agent-refresh-eval.md`](docs/developer/agent-refresh-eval.md#current-finding). Deterministische Navigation-Evals gegen Baselines sind in [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) und [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) dokumentiert. Ein zusätzlicher Live-LLM-Navigation-Eval ist noch nicht als aktiver Slice ausgewählt.

## Parked / später

1. [ ] Thin CLI Adapter über `src/core/` ergänzen.
   - Scope: kleiner CLI-Adapter, zuerst `status --json` und maximal ein Such-/Context-Befehl.
   - Test: CLI-Integration nutzt temp `stateDir`, dupliziert keine State-Logik und gibt stabiles JSON aus.

2. [ ] TypeScript-Pfadalias- und Konventions-Nachbarn nur nach Real-Repo-Eval-Miss-Analyse ausbauen.
   - Befund: Der lokale Real-Repo-Navigation-Eval zeigt Mehrwert für Search+Context, aber auch Lücken bei `@/lib/...`-Alias-Imports und Framework-/UI-zu-API-Konventionen.
   - Scope: erst Misses klassifizieren, dann minimalen Alias-/Konventions-Slice mit Budget- und Context-Gate bauen.

3. [ ] Später: Autoresearch als Parameter-Tuning-Schleife prüfen.
   - Voraussetzungen: stabile maschinenlesbare Metriken, feste Trainings-/Validierungs-Cases, Holdout-Guardrails und keine Optimierung nur auf ein privates lokales Repo.
   - Kandidaten: File-Rollen-Boosts, Noise-Penalties, Symbol-/Path-/Filename-/FTS-Gewichte, Token-Coverage-Bonus, Intent-Heuristiken, Context-Nachbarschaftsbudget.

4. [ ] Refresh-Automation nur bei breiterem Eval-/Praxisbedarf wieder aufnehmen.
   - Befund: Agent-Refresh-Eval mit `openai-codex/gpt-5.4-mini`, Baseline + Hint je 3 Runs, bestand 6/6; Agent sah stale Signale, rief `codemap_index`, suchte erneut und nannte `src/calculator.ts`.
   - Entscheidung: LLM-gesteuertes Refresh über bestehende stale Warnungen genügt vorerst; kein Command/Hook als nächster Slice.
   - Wieder aufnehmen, wenn breitere Modelle/Runs scheitern oder Praxis zeigt, dass Agenten stale Warnungen übersehen.
