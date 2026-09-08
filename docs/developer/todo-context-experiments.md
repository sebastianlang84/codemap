# Vier Kontexthebel

Basis `ef10b97`, unverändertes Zwölf-Fall-Korpus und Runner. Neue Baseline wird vor
Kandidaten gemessen. Jeder Hebel hat genau einen Kandidaten; Varianten werden
nacheinander ausgeführt, ohne Produktänderung. Runner-Prototypen verwenden dieselben
öffentlichen lokalen Funktionen. Keine Modellaufrufe oder neuen Werkzeugparameter.

## Vorab festgelegte Algorithmen und Gates

1. **Mehrere Spannen:** Erste Basisspanne behalten; bis zu zwei bisher nicht enthaltene
   Funktions-, Klassen-, Typ-, Interface- oder Exporttreffer der ersten acht Suchhits
   vor den restlichen Basisspannen einfügen. Je Treffer den vorhandenen Ortskontext
   verwenden. Enthaltene Duplikate auslassen; restliche Basisreihenfolge erhalten.
2. **Gezielte Ausschnitte:** Dateiauswahl und Reihenfolge unverändert. Je Spanne
   höchstens 80 % ihrer Ausgangsbytes ausgeben. Längste zusammenhängende Zeilenfolge
   um die Zeile mit den meisten unterschiedlichen Querywörtern wählen; Gleichstand
   früheste Zeile. Erweiterung abwechselnd nach oben/unten, bis keine Seite mehr
   passt. Kein Teil einer Zeile, kein synthetischer Quelltext. Ziel: insgesamt
   mindestens 20 % weniger Quellbytes, keine verlorenen vollständigen Ziele/Pakete.
3. **Aufgabe und bekannte Fundstelle:** Ohne Ground-Truth-Zugriff den ersten Suchhit
   als entdeckte Fundstelle benutzen. Dessen Ortskontext liefert Dateireihenfolge;
   pro Datei den ersten Querytreffer wählen, falls vorhanden, sonst die Ortsspanne.
   Restliche Querybasisspannen auffüllen. Dies ist ein Workflow-Prototyp, keine
   Messung einer unabhängig vom Suchsystem gelieferten menschlichen Fundstelle.
4. **Unsicherer Anker:** Bei verschiedenen Dateien in den ersten zwei Suchhits und
   relativem Scoreabstand höchstens 10 % beide Ortskontexte berücksichtigen:
   erste Basisspanne, erste Spanne des zweiten Ankers, übrige Basis. Sonst unverändert.
   Scoregleichstand behält Suchreihenfolge. Zusätzlich vorab eingefrorene Varianten:
   Original, kleingeschrieben, umgekehrte Leerraumtokenfolge. Varianten messen nur
   Ankerstabilität und ändern weder Hauptabfrage noch erwartete Zielspannen.

Alle Kandidaten halten acht Ausschnitte und die jeweiligen Basis-Quellbytekappen
hart ein. Außer Hebel 2 sind mindestens zwei zusätzliche vollständige Zielfälle
erforderlich. Kein vollständiger Ziel- oder Paketverlust; exakte Quelltextspannen.
Nur lokale Gewinner gehen weiter zu sämtlichen bestehenden Gates einschließlich
Real-Repo. Fehlgeschlagene lokale Kandidaten werden verworfen; unveränderte
Produktgates wären für solche Prototypen kein Wirksamkeitsnachweis. Kein Retuning.
Die genauen Implementierungen bleiben als inaktives Skript erhalten. Kein Bump:
ausschließlich Entwicklungsevidenz, keine aktivierte Produktänderung.

## Ergänzende Kontrollen

Nach Joint-Ausgabe angeforderter Diagnosevergleich, kein neuer Kandidat:
`search(query,8)` → `context(first.path:first.startLine-first.endLine,8)`.
Unverändertes heutiges Verhalten; keine künstliche Querycontext-Bytekappe in dieser
Kontrolle. Fehlende Sollspannen und Begleitpfade beschreiben verbleibenden Lesebedarf,
keine tatsächlich beobachteten Agentenaufrufe. Keine Nachstimmung des Joint-Kandidaten.

Vor Unsicheranker-Ausgabe zusätzlich festgelegte Kleinstfixture: `a.ts` und `b.ts`
enthalten dieselbe exportierte Funktion `dispatchMessage`, die ihr Argument
zurückgibt. Zweite Fixture ergänzt in `b.ts` einen Kommentar `handler`. Abfragen je
Fixture: `dispatchMessage handler`, `handler dispatchMessage`,
`dispatchmessage handler`. Gemessen werden erste zwei Scores, relatives Gefälle,
Ankerwechsel, ausgegebene Spannen und Source-/Budgetwahrheit. Beide Implementierungen
bleiben relevant. Exakte und eventuell knappe Ties sind Diagnosefälle; sie erhöhen
nicht den Zwölf-Fall-Gewinn. Falls keine knappe Nichtgleichheit entsteht, wird das
als fehlende Evidenz gemeldet, nicht die Fixture nachgestimmt.

## Ergebnisse

Die [neue Baseline](todo-context-baseline.json) gehört exakt zu `ef10b97`:
7/12 vollständige Ziele, 7/12 vollständige Pakete, 476.272 Quellbytes.
Sie ersetzt die vorherige gleichnamige Datei von `fd27c82`.

| Hebel | Vollständige Ziele | Pakete | Quellbytes gegen Basis | Entscheidung |
|---|---:|---:|---:|---|
| Mehrspannen | 9/12 | 8/12 | −42,12 % | verwerfen: bestehender Test scheitert |
| Ausschnitte | 0/12 | 0/12 | −20,47 % | verwerfen: sieben vollständige Fälle verloren |
| Aufgabe + Fundstelle | 7/12 | 1/12 | −68,44 % | verwerfen: sechs vollständige Pakete verloren |
| Unsicherer Anker | 7/12 | 7/12 | 0 % | verwerfen: kein Gewinn |

Mehrspannen gewinnt Plugin-Abhängigkeiten (`fastify-pr-6774`) und Validator
(`fastify-pr-6483`) ohne lokale vollständige Verluste. Die exakte
[Produktübertragung](../../scripts/fixtures/todo-context-spans-candidate.patch)
auf `ef10b97` besteht Typecheck, aber nur 341/342 Tests: der bestehende natürliche
Provider-Ausfall-Fall verliert Yahoo-Implementierung und Macro-Typdatei zugunsten
zusätzlicher Funktionsspannen. Weitere Gates einschließlich Real-Repo laufen nach
diesem Ablehnungsgrund nicht. Produktpatch zurückgenommen; keine Erwartungen geändert.

Gegen den heutigen [Zweischritt](todo-context-location-control.json) liefert Joint
weiterhin 7/12 vollständige Ziele und 1/12 Pakete. Quellbytes: 157.580 → 150.334
(−4,60 %). Sechs fehlende Sollspannen bleiben sechs; fehlende Begleitpfade sinken
14 → 12. Zwei zusätzliche Pfade machen noch kein vollständiges Paket. Keine
Messung realer Agenten-Folgelesungen oder Gesamtlaufzeit. Die nachträglich ergänzte
Kontrolle war nicht Teil des ursprünglichen Joint-Freeze; es wurde nicht nachgestimmt.

Die [Tie-Diagnose](todo-context-ties.json) enthält sechs exakte Scoregleichstände.
Alle sechs geben vorher und nachher beide Implementierungen aus; Quelltext und
Budget bleiben korrekt. Der Zusatzkommentar erzeugt keinen ungleichen knappen
Scoreabstand. Keine Nachstimmung; eine solche Fixture bleibt hier unbelegt.

Der [Unsicheranker-Lauf](todo-context-uncertain.json) enthält fünf knappe ungleiche
Ankerpaare: HTTP/2, Content-Parser, Link, SendFile und Media-Type mit relativen
Scoreabständen von 1,20 bis 9,58 %. Trotzdem keine zusätzlichen vollständigen
Ziele/Pakete oder Byteersparnis. Beim Media-Type-Fall ändert eine eingefrorene
Eingabevariante die zuerst gerankte Datei; der Kandidat verbessert den Hauptfall
nicht. Alle zwölf Source-/Budgetchecks bestehen.

Ergebnisdateien: [Mehrspannen](todo-context-spans.json),
[Ausschnitte](todo-context-bytes.json), [Joint](todo-context-joint.json).
Alle vier Hebel enden ohne Produktänderung. Keine Agentennutzen- oder
unabhängige Bestätigungsbehauptung.

## Reproduktion

`npm run build` auf `ef10b97`. Baseline mit `scripts/eval-context-program.py` und
`--cli dist/cli/bin.js` erzeugen. Für Kandidaten eine lokale Datei
`dist/cli/todo-context.js` mit `import '../../scripts/todo-context-prototype.mjs';`
anlegen. `scripts/todo-context-eval.py` erhält diesen CLI-Pfad, `--baseline
 docs/developer/todo-context-baseline.json` und den Ausgabepfad. Modi über
`CODEMAP_CONTEXT_EXPERIMENT`: `spans`, `bytes`, `joint`, `uncertain`.
Der Kontrolllauf importiert stattdessen `todo-context-location-control.mjs` und
verzichtet auf `--baseline`, damit das heutige Verhalten nicht künstlich gekürzt wird.
`TMPDIR=/home/wasti/.cache/codemap` hält temporäre Snapshots vom knappen `/tmp` fern.
`scripts/todo-context-summary.py BASE RESULT` vergleicht unveränderte Sollspannen.
Die exakten Prototypen wurden vor Kandidatenausgabe in `c49ed1c` eingecheckt.
