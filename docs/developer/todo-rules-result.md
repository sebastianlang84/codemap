# Regelablation: beide Änderungen verworfen

2026-09-08, Produktbasis `ef10b97`. [Protokoll](todo-rules-protocol.md) vor der Messung
committed (`395df99`); zwölf bekannte Entwicklungsfälle, zwei Wiederholungen.
[Messdaten](todo-rules-result.json) enthalten Pool-/Quellhashes, Bereiche und Einzelwerte.
Native Such-/Kontextauswahl wurde vor der Ablation identisch reproduziert.

| Separater Hebel | Vollständige Zielspannenfälle | Vollständige Pakete | Pfad-Recall@5 |
|---|---:|---:|---:|
| Suche unverändert | 9/12 | 6/12 | 84,82 % |
| Ohne zusätzlichen FTS-Score | 9/12 | 6/12 | 84,82 % |
| Kontext unverändert | 7/12 | 7/12 | 69,94 % |
| Kontext: Suchreihenfolge zuerst | 9/12 | 7/12 | 84,82 % |

Die Suchkontrolle ändert eine Rangfolge, gewinnt keinen vollständigen Fall; MRR sinkt
von 0,836 auf 0,822. **Keine Fortsetzung.** Entfernt wurde nur der zusätzliche
`ftsScore` (einschließlich nahezu binärem FTS-Trefferbonus), nicht BM25 beim SQL-Pooling.
Prefix-/Erweiterungspools und weitere Scores blieben exakt gleich.

Die Kontextkontrolle gewinnt lokal `fastify-pr-6774` und `fastify-pr-6483`, verliert
keinen vollständigen Zielfall und besteht das lokale Fortsetzungsgate. Quellbytes
steigen von 160.073 auf 163.273; beide Profile bleiben je Fall innerhalb 16 KiB.
Die Anzahl vollständiger Aufgabenpakete steigt nicht.

Der daraus abgeleitete [exakte Produktpatch](todo-rules-context-candidate.patch)
**verletzt bestehende Anforderungen und wurde zurückgenommen**: Die Reviewer-Aufgabe
verliert ihre Benchmark-Fixtures; der Catalog-Endpunkt verliert seinen zugehörigen Test.
Beide Fehler wurden isoliert reproduziert. Insgesamt scheitern elf funktionale Tests;
nach Rücknahme bestehen alle 34 betroffenen Navigations-/Auswahltests wieder. Weitere
Regeln wurden in dieser Runde nicht nachgestimmt.

Die parallelen Kontext-/Navigationsgates scheiterten ausschließlich an Latenzgrenzen;
ihre funktionalen Metriken bestanden. Diese Zeiten sind keine Leistungsaussage.
Der gesamte Testsatz hatte zusätzlich zwei Harnessfehler: Cache-TMPDIR unter HOME
verletzt die Agentenisolierung; ein Prozess-Timeouttest scheiterte. Sie begründen
nicht die Ablehnung des Kontextpatches. Es wurden keine Modelle aufgerufen.

## Grenze und Reproduktion

Gleiche Kandidaten/Bereiche und Budgets isolieren die **zusätzliche Scorekomponente**
und die **finalen Kontextprioritäten**. Frühere Nachbarprioritäten, Sprachextraktion
und Kandidatenaufnahme wurden nicht abgetragen. Das ist keine Aussage über sämtliche
Regeln, andere Repository-Strukturen oder den Nutzen bei adaptiver Agentenarbeit.
Die Befunde sprechen gegen pauschales Entfernen der Regeln, nicht gegen Vereinfachung
mit besser belegter Auswahl. Produktcode bleibt unverändert.

```bash
TMPDIR="$HOME/.cache/codemap" python3 scripts/todo-rules.py --output "$HOME/.cache/codemap/todo-rules-repeat.json"
TMPDIR="$HOME/.cache/codemap" python3 scripts/todo-rules-test.py
```

Vier Reader-/Metriktests und die explizite TypeScript-Prüfung des Adapters bestehen.
Die beiden abgebrochenen Readerläufe korrigierten nur terminale Leerzeilen und leere
Dateien; Kriterien, Queries und Auswahlverfahren blieben unverändert.
