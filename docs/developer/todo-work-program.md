# CodeMap-TODOs: autonomes Arbeitsprogramm

2026-09-08. Auftrag: die elf gesammelten Prüfaufträge abarbeiten. Basis `ee1a817`.
Produktänderungen bleiben einzeln prüfbar. Keine Releases, Tags oder globale Umstellung.

## Reihenfolge und Kriterien

1. **Messintegrität:** Laufzeitprofil technisch ohne Eval-Dateien; gleiche vollständige
   Qualitätsprüfung einschließlich interner Typen und Aufrufsignaturen. Basis/Referenz
   und tatsächliches Sandboxprofil müssen vor Modellstart bestehen beziehungsweise
   am eingefrorenen Feature-Test gezielt scheitern. Alte Manifeste bleiben unverändert.
2. **Ausgabe:** CLI-Text/JSON, MCP-Text/Strukturdaten und Pi getrennt prüfen. Historische
   Folgelesungen nur als redundant zählen, wenn der entsprechende Quelltext zuvor
   tatsächlich in der beobachteten Werkzeugantwort enthalten war.
3. **Korrektheitsfehler:** Kommentare/String-Inhalte als Scheinimporte, verlorene späte
   Query-Identifikatoren und konkret belegte Referenzlücken mit negativen Kontrollen
   reproduzieren. Bestehende Sprach-/Such-/Kontextgates bleiben bindend.
4. **Kontext:** Bereichsauswahl, Gesamtbudget, Aufgabe plus Fundstelle und unsichere
   Anker als getrennte Hebel prüfen. Zuerst lokale Entwicklung auf dem unveränderten
   Zwölf-Fall-Kontextkorpus plus bestehenden Gates. Höchstens zwei Kandidaten je Hebel;
   keine nachträgliche Erwartungsänderung. Ein Kandidat braucht mindestens zwei zusätzliche
   vollständige Zielspannenfälle oder einen vorher festgelegten Budgetgewinn von 20 %,
   keinen verlorenen vollständigen Fall und sämtliche bestehenden Gates.
5. **Regeln:** BM25-Zusatzscore und Kontextprioritäten einzeln gegen einfachere Kontrollen
   abtragen. Gleicher Kandidatenpool beziehungsweise dieselben Bereiche und Budgets;
   keine aus Diagnoseergebnissen nachgestimmten Punktwerte. Ein lokaler Gewinn bleibt
   Entwicklungsevidenz, keine unabhängige Bestätigung.
6. **Agentennutzen:** nach Integritätsprüfung neue unveränderliche Manifeste für normale
   adaptive Suche, CodeMap-Suche allein und bisherigen Kontextablauf. Zwölf bekannte
   Entwicklungsaufgaben, alle Varianten auf demselben Produktstand, gleiche Testhilfe,
   wechselnde Reihenfolge. Luna medium über vorhandenen Login, höchstens 36 reguläre
   Aufrufe und zwei Infrastruktur-Ersatzversuche, je 15 Minuten. Erfolglos ist kein Retry.
   Qualität vollständig gleich; Gate gegen normale Suche: keine Qualitätsverluste,
   mindestens 15 % weniger Gesamtzeit, mindestens 8/12-mal schneller, Tokenverhältnis
   höchstens 1,10. Erst bei bestandenem Gate unabhängige Bestätigung, maximal zwölf
   neue Paare. Bestätigungsinhalte bleiben bis dahin ungeöffnet. Neue konkrete Manifest-
   und Verifier-Hashes vor dem ersten Modellaufruf festhalten; keine laufenden Produkt-
   Experimente während der Zeitmessung.

Ein verworfener Versuch schließt seinen Prüfauftrag mit Befund und Grenze ab; er ist
keine Reparatur. Korrektheitsfixes benötigen keinen künstlichen Effizienznachweis.
Suche allein ohne Gewinn widerlegt gezielten Kontext nicht automatisch. Rohtraces
bleiben im privaten Cache, kompakte Prüfberichte im Repo; TODOs werden erst bei
vollständig dokumentiertem Ergebnis entfernt.
