# Span-Replay: additive Mehrspannen

Vorab eingefroren am 2026-09-24, vor jeder Kandidatenausgabe. Anlass ist die
Modelldebatte vom 2026-09-24 (Transkript außerhalb des Repos): Sie schlägt als billigen Filter vor dem nächsten Agentenvergleich
einen Replay vor, der benötigte Zeilen pro Byte sichtbarer Ausgabe misst.
Der [Mehrspannen-Hebel vom 8. September](todo-context-experiments.md) erreichte 9/12 vollständige Ziele.
Er wurde verworfen, weil eingefügte Spannen bestehende Basisspannen verdrängten und dadurch ein
bestehender Test zwei benötigte Dateien verlor. Dieser Kandidat hängt deshalb nur an, statt zu verdrängen.

## Korpus und Messung

Unverändertes Zwölf-Fall-Korpus `scripts/eval-context-program.manifest.json` und derselbe Runner
`scripts/todo-context-eval.py`. Der Runner zählt zusätzlich:

- abgedeckte Sollzeilen, also Zielzeilen, die von quelltreuen Spannen desselben Pfads abgedeckt sind;
- sichtbare Bytes, gemessen als kompaktes JSON jeder Antwort, die ein Agent sähe;
- Sollzeilen pro KiB sichtbarer Ausgabe.

Alle drei Arme laufen auf demselben Produktstand; `scripts/span-replay.mjs` wählt den Modus.

| Arm | Ablauf |
|---|---|
| B (Basis) | `codemap context "<query>" --limit 8`, unverändert |
| S (Skill) | `codemap search --limit 8`, danach `codemap context "<erster Treffer path:start-end>" --limit 1`; sichtbar sind beide Antworten |
| A (Kandidat) | B plus bis zu zwei angehängte Spannen: Die ersten acht Suchtreffer der Art Funktion, Klasse, Typ, Interface oder Export werden in Rangfolge geprüft. Übernommen wird jeweils die Ortsspanne (`context path:start-end --limit 1`), sofern keine enthaltene Spanne sie vollständig abdeckt. Basisspannen bleiben vollständig und in ihrer Reihenfolge erhalten. |

A überschreitet die Grenze von acht Ausschnitten um höchstens zwei. Das ist beabsichtigt und wird berichtet.
Die Kosten zusätzlicher Bytes erfasst das Effizienz-Gate.

## Gates für A gegen B

1. Mindestens zwei zusätzliche vollständige Ziele.
2. Kein Verlust eines vollständigen Ziels oder Pakets.
3. Sollzeilen pro KiB sichtbarer Ausgabe mindestens so hoch wie bei B.
4. Alle Spannen quelltreu.

S ist eine beschreibende Referenz für den heutigen Skill-Weg und hat kein Gate.

## Entscheidung

- **Scheitert A an einem Gate:** A wird verworfen, ohne Nachstimmung.
- **Besteht A alle Gates:** Das ist nur Entwicklungsevidenz. Weiter geht es erst mit einem eigenen
  Protokoll, das festlegt:
  - die Produktübertragung;
  - sämtliche bestehenden Tests und Gates einschließlich Real-Repo;
  - den externen Holdout (40 Fälle) als unabhängige Prüfung.
- **In beiden Fällen:** Der Agentenvergleich auf einem großen Repo gegen adaptive `rg`-Suche braucht
  ein eigenes Protokoll.

## Grenzen

Die zwölf Fälle sind bekannte Entwicklungsfälle, die schon am 8. September verwendet wurden.
Die Anhängeregel leitet sich aus dem damaligen Ablehnungsgrund ab. Ein Bestehen belegt daher weder
unabhängige Bestätigung noch Agentennutzen. Sichtbare Bytes messen kompaktes JSON, nicht die
Darstellung eines konkreten Hosts.

## Reproduktion

1. `npm run build`.
2. Eine lokale Datei `dist/cli/span-replay.js` mit `import '../../scripts/span-replay.mjs';` anlegen.
   Sie wird nicht eingecheckt.
3. Basis: `scripts/todo-context-eval.py --cli dist/cli/bin.js`.
4. Arme S und A: `CODEMAP_SPAN_REPLAY=skill` bzw. `additive` und `--cli dist/cli/span-replay.js`.
5. `TMPDIR=/home/wasti/.cache/codemap` setzen.
