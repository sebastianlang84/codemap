# Klassenaufteilung im Chunker: Ergebnis

[Protokoll](class-split-protocol.md), gemessen am 2026-09-24 gegen den Ausgangsstand `4f88d17`.

## Kandidat 1: verworfen

Gate 1 gescheitert: drei Tests von `npm run verify` schlagen fehl.

- **Echter Fehler:** Steht in einer großen Klasse `def fake():` oder `function fake() {` in einem
  String oder Template-String, legt der Chunker dafür jetzt einen Funktions-Chunk an. Vorher
  verschwand der String im Klassen-Chunk. Zwei Tests fangen das.
- **Zweckverlust eines Tests:** Der Test für begrenzte Ortsanfragen nutzt eine große Klasse. Nach der
  Aufteilung gibt es dort keinen großen Chunk mehr, und der Test prüft seinen Pfad nicht mehr.

Alle übrigen Gates halten:

- Fixture-Gates, Real-Repo-Gate und externer Holdout: keine Qualitätskennzahl verändert.
- Span-Replay: keine Verluste. Arm B braucht 552.089 statt 619.398 sichtbare Bytes (−11 %), fast
  ausschließlich durch einen Flask-Fall (86.044 → 18.735 Bytes).
- Beschreibend: Mit den ursprünglichen Suchanfragen der Aufgaben vom 8. September steigt
  `src/flask/app.py` in Aufgabe 03 von Rang 7 auf Rang 2 beziehungsweise 4. `src/flask/sansio/app.py`
  erscheint in Aufgabe 09 auf Rang 9, vorher war die Datei nicht unter den Top 10. Gemessen wurde auf einer Flask-Kopie aus dem
  Qualitätslauf, nicht auf dem exakten Aufgabenstand.

## Kandidat 2: eingefroren vor Kandidatenausgabe

Entworfen **nach** dem Ergebnis von Kandidat 1; seine Zahlen sind deshalb keine unabhängige
Bestätigung. Neuer Befund, der den Versuch rechtfertigt: die beschreibende Rangverbesserung für
Flask bei unveränderten Gates.

- **Änderung:** Kandidat 1 plus: Der Chunker erkennt keine Klassen- und Funktionsdeklaration in
  einer Zeile, die innerhalb eines Strings, Template-Strings oder Blockkommentars beginnt. Das gilt in
  allen strukturierten Sprachen und auf jeder Ebene, nicht nur in großen Klassen.
- **Testumbau, vorab festgelegt:** Der Test für begrenzte Ortsanfragen bekommt statt der großen
  Klasse eine Funktion über 150 Zeilen mit einer inneren Funktion. Seine Zusicherungen bleiben:
  innere Funktion, auf mindestens 80 Zeilen erweiterte Zeilen und Bereiche über mehrere Chunks.
- **Gates:** unverändert die vier Gates aus dem Protokoll, gegen denselben Ausgangsstand.
