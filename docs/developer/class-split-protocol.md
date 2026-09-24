# Klassenaufteilung im Chunker

Vorab eingefroren am 2026-09-24, vor jeder Kandidatenausgabe. Anlass: Die
[Spurenanalyse der Agentenläufe vom 8. September](span-replay-result.md#nachmessung-nach-drei-ortsfixes)
zeigte Klassen-Chunks ohne Größengrenze: Bei Flask liegen 27 % der Codezeilen in Chunks über
150 Zeilen, der größte hat 1.519 Zeilen. Die Ortsfixes begrenzen seither nur die Ausgabe von
`context`; Suche und Rangfolge sehen weiter den ganzen Klassen-Chunk.

## Kandidat

Eine Klasse mit mehr als 150 Zeilen wird im Chunker nicht mehr als ein Chunk abgelegt. Ihre
Kopfzeile bis vor die erste Methode und die Methoden werden so zerlegt, wie der Chunker Dateiinhalt
schon heute zerlegt: erkannte Funktionen als Funktions-Chunks, Lücken als feste Text-Chunks. Kleinere
Klassen und alle anderen Chunkarten bleiben unverändert.

## Messung

Ausgangswerte sind am Commit `4f88d17` gesichert, gemessen auf demselben Rechner:

- `npm run verify` mit allen Fixture-Gates (Suche, Semantik, Kontext, Agentennavigation);
- `eval:real-repo-navigation:gate`;
- `eval:external-holdout:gate` (40 Fälle);
- Span-Replay in allen drei Armen ([Protokoll](span-replay-protocol.md)).

## Gates

1. `npm run verify` grün, Real-Repo-Gate und externer Holdout bestehen.
2. Keine Kennzahl der Fixture-Gates, des Real-Repo-Gates und des Holdouts sinkt gegenüber dem
   Ausgangswert (Erfolg, Top-1, Recall, MRR, vollständige Treffer). Latenzen sind ausgenommen.
3. Span-Replay: kein Arm verliert ein vollständiges Ziel, ein Paket oder abgedeckte Sollzeilen.
4. Alle Spannen quelltreu.

Scheitert ein Gate, wird der Kandidat ohne Nachstimmung verworfen. Beschreibend und ohne Gate wird
berichtet, auf welchem Rang die Zieldatei der Flask-Aufgaben 03 und 09 vom 8. September mit deren
ursprünglichen Suchanfragen landet.

## Grenzen

Alle Korpora sind bekannt; auch der Holdout wurde schon für frühere Entscheidungen genutzt.
Ein Bestehen belegt keinen Agentennutzen. Bestehende Indexe übernehmen die Aufteilung erst nach
`codemap index`.
