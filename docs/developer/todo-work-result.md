# Prüfaufträge vom 8. September

[Vorabprogramm](todo-work-program.md), Ausgangsstand `ee1a817`.
Korrektheitsfixes sind integriert; keiner der Kontext-/Regelkandidaten wurde übernommen.
Der zusammengeführte Stand besteht 344 Tests und alle bestehenden Gates, einschließlich
Live-Repo mit sieben Kontextgewinnen und keinem Verlust. Keine Veröffentlichung.
Die lokalen globalen CLI-/MCP-Verweise zeigen auf den Build dieses Repos;
neue Aufrufe verwenden die Korrekturen bereits. Laufende Hosts wurden nicht neu gestartet.

| Prüfauftrag | Ergebnis |
|---|---|
| Vollständige Qualitätsprüfung | Gleiche deklarierte Prüfungen für beide Agentenvarianten; interne Typen und alte/neue Aufrufe zählen zur Korrektheit. Zwölf Referenzen validiert, Fall 09 mit expliziter lokaler Referenzkorrektur. [Beleg](todo-quality-validation.md). |
| Laufzeitprofil | Nur geprüfte Laufzeitdateien und Produktionsabhängigkeiten werden eingebunden; Eval-Dateien und Lösungen ausgeschlossen. |
| Adapterausgabe | [CLI-Traces](todo-adapter-audit.md) und [echte Hostrequests](todo-host-output-result.md) geprüft: Pi und ausdrücklich weitergereichte Codex-MCP-Antworten enthalten den vollständigen Quelltext. |
| Suche allein | [36 Läufe abgeschlossen](todo-agent-development-result.md), alle korrekt. Suche: +20,0 % Zeit / +40,4 % Tokens; Kontext: +28,9 % / +58,3 %. Beide Effizienz-Gates verfehlt; keine unabhängige Bestätigung. |
| Mehrere Bereiche | Lokal zwei zusätzliche vollständige Ziele, aber benötigte Dateien in bestehendem Test verloren; verworfen. |
| Quelltextbudget | 20,47 % weniger Bytes, alle sieben vollständigen Fälle verloren; verworfen. |
| Aufgabe und Fundstelle | Gegen heutigen Zweischritt gleiche Vollständigkeit, 4,60 % weniger Bytes; kein ausreichender Gewinn. |
| Lange Fragen / unsichere Anker | Späte explizite Identifikatoren bleiben erhalten; reine Prosa behält ihre bisherige Reihenfolge. Zweiter unsicherer Anker bringt keinen Gewinn. |
| Falsche Importkanten | Kommentare, Strings und erkannte reguläre Ausdrücke werden ausgeblendet. Bestehende Graphen werden beim Refresh neu aufgebaut. |
| Fehlende Verweise | Eindeutige lokale `.d.ts`- und absolute Python-Verweise ergänzt. Literale Dateileseverweise bleiben unaufgelöst, siehe Grenze unten. |
| Sonderregeln | Zusatzscore abtragen bringt keinen Gewinn; einfachere Kontextprioritäten verletzen bestehende Aufgabenanforderungen. |

[Vier Kontextversuche](todo-context-experiments.md) und [Regelablationen](todo-rules-result.md)
dokumentieren Algorithmen, Einzelwerte und verworfene Patches. Bekannte Entwicklungsfälle
belegen weder unabhängige Bestätigung noch Zeitersparnis bei Agentenarbeit.

Literale Dateileseverweise wurden nicht als Importe ausgegeben. Im Plugin-Fall fehlen
weiterhin zusammengehörige Test-, Typ- und Dokumentationsausschnitte. Die relevanten
Dokumentationschunks übersteigen bereits einzeln das gesamte Quellbudget; zusätzliche
Dateipfade beheben das nicht. [Bereichs-/Budgetbefund](context-program-experiments.md#package-3-feasibility-of-additional-file-relationships)
und die jetzt verworfenen Ausschnittversuche begründen die Zurückstellung.
Auch die JavaScript-Lexik ist kein vollständiger Sprachparser; insbesondere die
Erkennung von Regex-Literalen nach Kontrollausdrücken bleibt begrenzt.
