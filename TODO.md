# TODO

## Arbeitsregeln für die Backlog-Pflege

Quelle: [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) plus Architektur-/TDD-Review. CodeMap bleibt primär **Agent-Navigationswerkzeug**: Einstiegspunkt + Nachbarn + Gründe, nicht allgemeines Code-Retrieval-System.

Architektur-Linse:

- Bevorzugt tiefe **Module** mit kleiner **Interface** und viel **Implementation** dahinter.
- Neue Arbeit soll klare **Seams** stärken: Core-Module zuerst, Pi/CLI nur als dünne **Adapter**.
- Gute TODOs erhöhen **Leverage** für Nutzer und **Locality** für Maintainer.

TDD-Regel:

- Ein vertikaler Slice nach dem anderen: ein öffentlicher Behavior-Test → minimale Implementation → Refactor.
- Tests laufen möglichst über öffentliche Interfaces wie `indexRepo`, `status`, `searchCodeMap`, `codemapContext` oder Adapter-Commands.
- Keine horizontale Mega-Suite und keine primäre Kopplung an private Helper; interne Diagnostics dürfen ergänzen, aber nicht der Produktbeweis sein.

## Active tactical backlog — reviewed order

1. [ ] Context Builder Module: verbleibende Herkunftsgründe und Locality verbessern.
   - Architektur: `codemapContext` bleibt kleine Interface; Beziehungserkennung und Nachbarschaftslogik liegen hinter dem Context-Builder-Seam.
   - Bereits erledigte Slices: `readFirst` Items tragen `reasons[]`; TS/JS Imports, Python relative Imports, C/C++ quoted Includes und Header/Source-Paare werden aus indexierten Chunks abgeleitet; Stale-Verhalten bleibt indexbasiert.
   - Offen: `near_config`, `same_dir`, feinere Testrollen wie `test_of`, `sibling_test`, `reverse_test`; Tests sind nützliche Rollen, keine Noise-Klasse.
   - Behavior-Test: Fixture mit Modul, Caller, Test, naher Config, Doc und Rauschdatei liefert Target + echte Beziehungen stabil vor Rauschen und erklärt die Herkunft der Context-Items über `reasons[]`.

2. [ ] Typische Query-Klassen als vertikale TDD-Slices abdecken.
   - Architektur: Keine neue Retrieval-Schicht; Query-Plan/Ranking werden nur vertieft, wenn ein öffentlicher Navigationsfall es verlangt.
   - Scope: Einzelne repräsentative Slices für Symbol, Pfad, Fehlermeldung, Endpoint/Route, Config-Key und noisy query.
   - TDD-Regel: Nicht alles vorab schreiben. Pro Query-Klasse: ein Fixture, ein öffentlicher Test für Top-Ergebnis + optional Context-Paket, dann minimale Implementation.
   - Benefit: Verbesserungen bleiben auf agentische Navigationsfälle ausgerichtet statt auf abstrakte Retrieval-Metriken.

3. [ ] DB-/Migration-Schema-Tests ergänzen.
   - Architektur: Index-Storage wird als langlebiges Core-Modul abgesichert; Migrationen dürfen Adapter und Ranking nicht leaken.
   - Scope: Migrationen/SQLite-Schema, Index-Versionierung und bestehende DB-Aktualisierung explizit testen.
   - Behavior-Test: Vorhandene/alte Test-DB oder simulierte Vorversion wird über öffentliche Index-/Search-Pfade geöffnet; Version steigt, Index/Search funktionieren, keine Datenverluste oder Crashs.
   - Benefit: Quality-Metriken sind nur belastbar, wenn der Index reproduzierbar und migrationssicher ist.

4. [ ] Search-Quality-Gate deterministisch und closeout-tauglich machen.
   - Architektur: Benchmark/Quality-Metriken sind ein Diagnose-Seam, nicht Teil des Public SearchResult.
   - Problem: `scripts/bench-search-quality.ts` und `test/search-quality.test.ts` existieren, aber lokale Default-Repos unter `/home/wasti/...` sind kein stabiler Pflicht-Gate.
   - Scope: Trennen zwischen verpflichtendem deterministischem Fixture-Gate und optionalen lokalen Tuning-Fixtures.
   - Behavior-Test: `npm run bench:search-quality:gate` oder ein neuer Pflichtmodus läuft ohne private lokale Repos stabil grün; lokale Real-Repo-Benchmarks bleiben als optionales Tuning sichtbar.
   - Closeout: Vor Release/Commit-Closeout sollen `npm run typecheck`, `npm test` und der deterministische Quality-Gate klar dokumentiert sein.

5. [ ] Fehlgeschlagene Natural-Language-Benchmark-Cases als konkrete Regressionen bearbeiten.
   - Einordnung: Nur sinnvoll, wenn jeder rote Case in einen überprüfbaren Behavior-Fall überführt wird.
   - Scope: Pro rotem Case Top-5-Treffer, erwartete Pfade, Query-Formulierung, Ranking-Diagnostics, Noise-Hits und Miss-Klasse analysieren.
   - Entscheidung je Case: Ranking/Query-Plan/File-Rollen verbessern, Ground Truth korrigieren oder Case als ungeeignet entfernen; keine Benchmark-Erleichterung nach Ergebnislage.
   - Test: Ein konkreter Regressionstest oder Benchmark-Case mit maschinenlesbarem Erfolgskriterium; keine bloße Notiz „Gate später grün machen“.

6. [ ] Thin CLI Adapter über `src/core/` ergänzen.
   - Architektur: `src/cli/` ist Adapter, nicht neue Implementation; Core bleibt Single Source of Truth für Approval, State, Status, Search und Context.
   - Scope: Kleiner CLI-Adapter, zuerst `status --json` und maximal ein Such-/Context-Befehl.
   - Behavior-Test: CLI-Integration nutzt temp `stateDir`, dupliziert keine State-Logik und gibt stabiles JSON aus.
   - Benefit: Prüft die Core/Adapter-Seam und macht CodeMap außerhalb der Pi-Extension nutzbar; verbessert Search-Qualität nicht direkt.

## Parked / später

7. [ ] Refresh-Automation als expliziten Command oder Hook entscheiden.
   - Einordnung: Erst nach besserem Status-Modul sinnvoll. Kein Daemon/Background-Crawling als Default.
   - Scope: Kurze ADR/Doc-Entscheidung plus kleinster Implementierungs-Slice.
   - Behavior-Test: Gewählter Command/Hook respektiert Approval, `pathPrefix` und stale-index Warnungen.

8. [ ] Später: Autoresearch als Parameter-Tuning-Schleife prüfen.
   - Einordnung: Möglichkeit zur Verbesserung, **nicht** erster Schritt. Vorher müssen stabile Tests, Ground-Truth-Cases und maschinenlesbare Metriken existieren.
   - Idee: Autoresearch kann Ranking-Parameter adaptieren, wenn Resultate quantifiziert werden; `/home/wasti/dev/autoresearch/program.md` beschreibt bereits ein passendes Experimentprotokoll.
   - Voraussetzungen: maschinenlesbare Benchmark-Ausgabe mit `top1Accuracy`, `recallAt5`, `expectedCoverageAt5`, `mrrAt5`, `avgLatencyMs`, `p95LatencyMs`, `misses`, `partialMisses` und `excludedHits`; feste Trainings-/Validierungs-Cases; keine Anpassung ausschließlich auf ein einzelnes lokales Repo.
   - Kandidatenparameter: File-Rollen-Boosts, Noise-Penalties, Symbol-/Path-/Filename-/FTS-Gewichte, Token-Coverage-Bonus, Natural-Language-Intent-Heuristiken, Context-Nachbarschaftsbudget.
   - Guardrails: Holdout-Cases, Regressionsgrenzen für Latenz und Noise, nachvollziehbare Parameter-Diffs, kein automatisches Übernehmen ohne Review.

## Completed / narrowed by review

- Token-Injection-Budget: `scripts/check-token-injection.ts`, `npm run check:token-injection` und `test/token-injection-budget.test.ts` berichten/prüfen die geschätzten Kontextkosten der registrierten CodeMap-Tools für `description`, `parameters`, `promptSnippet` und `promptGuidelines` mit Per-Tool- und Gesamtbudget.
- Ranking Module: Source-/Config-/Docs-/Test-Rollen werden für Navigationsqueries stärker priorisiert; lock/generated/build/vendor/minified/large-JSON bleiben bei normalen Queries Noise, sind über explizite Noise-/Pfadqueries aber weiterhin findbar; Search- und Read-first-Verhalten ist per Fixture-Test abgedeckt.
- Git-aware Status Module: `status({ health: "full" })` meldet jetzt `currentHead`, `indexedHead`, `headChanged`, `dirty`, `dirtyFiles` und den passenden `lastIndexedAt`; Git-HEAD/Dirty-Working-Tree-Drift wird über öffentliche `indexRepo`/`status`-Tests abgedeckt.
- Ranking-Diagnostics: erster interner Helper `scoreSearchRow()` zerlegt Treffer in `finalScore`, Retrieval-/FTS-/Path-/Filename-/Symbol-/Coverage-Scores, Rollenboosts, Test-/Doc-/Noise-Penalties und gematchte Tokens; Public `SearchResult` bleibt ohne Explain-Felder. Wenn daran weitergearbeitet wird, dann über einen klaren Debug-/Benchmark-Seam statt Tests gegen beliebige private Implementation.
- Agentischer E2E-Smoke-Test: `test/search.test.ts` prüft die Produkt-Interface-Kette über `codeMapIndex -> codeMapSearch -> codeMapContext`: „where is the main implementation?“ findet den Source-Einstiegspunkt, und das Read-first-Paket enthält Target plus Import-/Test-/Doc-Nachbarn ohne Lockfile-/Generated-/Build-Noise.
- Search-Quality-Metriken: Metriken und Gate existieren in `scripts/bench-search-quality.ts` und `test/search-quality.test.ts`. Aktive Arbeit ist jetzt nicht „Metriken bauen“, sondern deterministische Pflicht-Gates und konkrete Regressionen.

Weitere Zukunfts- und Parkthemen stehen in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work). Abgeschlossene Lieferungshistorie steht dort bzw. im Changelog, nicht als aktive TODOs.
