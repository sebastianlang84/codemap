# Span-Replay: Ergebnis

2026-09-24, Produktstand `2037714`, [eingefrorenes Protokoll](span-replay-protocol.md) `5ae6aaa`.
**Der additive Kandidat A besteht alle vier Gates. Das ist Entwicklungsevidenz, keine Produktänderung.**

| Arm | Vollständige Ziele | Pakete | Sollzeilen | Sichtbare Bytes | Sollzeilen/KiB |
|---|---:|---:|---:|---:|---:|
| B: Query-Kontext, 8 Ausschnitte | 7/12 | 7/12 | 384/692 | 606.492 | 0,65 |
| S: Suche + Fundstelle | 7/12 | 0/12 | 308/692 | 79.085 | 3,99 |
| A: B plus zwei Definitionsspannen | 10/12 | 9/12 | 581/692 | 658.207 | 0,90 |

## Gates für A gegen B

1. **Zusätzliche vollständige Ziele:** +3 (`fastify-pr-6774`, `fastify-pr-6483`, `flask-pr-6096`). Gefordert waren +2.
2. **Verluste:** Kein vollständiges Ziel und kein Paket verloren.
3. **Effizienz:** 0,90 statt 0,65 Sollzeilen pro KiB (+39 %), bei 8,5 % mehr sichtbaren Bytes.
4. **Quelltreue:** Alle Spannen quelltreu.

Das Replay-Metadatenfeld `visibleBytes` zählt nicht zur sichtbaren Ausgabe, weil ein Agent es nie sähe.
A überschreitet die Grenze von acht Ausschnitten in sieben Fällen um eine oder zwei Spannen.

## Beobachtungen

S bildet den Skill ab dem CodeMap-Aufruf ab; die vorangehende `rg`-Suche, nach der der Skill
erst greift, ist nicht mitgezählt. S findet dieselben sieben vollständigen Ziele wie B mit 13 % der sichtbaren Bytes.
Pro Byte liefert er sechsmal so viele Sollzeilen. Ihm fehlen aber alle Begleitpfade (Tests),
deshalb erreicht er kein vollständiges Paket.

Zwei Fälle mit je rund 145 KB (`express-pr-6903`, `express-pr-6073`) machen fast die Hälfte der
Bytes von B aus. In beiden Fällen ist das Ziel schon in B vollständig.

## Nachmessung nach drei Ortsfixes

Am selben Tag nach drei Produktfixes erneut gemessen:
- Ein Ort in einer Klasse über 150 Zeilen liefert die umschließende Funktion oder höchstens die genannten Zeilen,
  mindestens 80, statt der ganzen Klasse.
- Ein Bereich über mehrere Chunks oder über das Dateiende wird geliefert beziehungsweise gekürzt statt abgelehnt.
- Eine Python-Signatur, deren schließende Klammer auf der Einrückung von `def` steht, behält ihren Rumpf im Chunk.

| Arm | Ziele | Pakete | Sollzeilen | Sichtbare Bytes | Sollzeilen/KiB |
|---|---:|---:|---:|---:|---:|
| B | 8/12 (vorher 7) | 8/12 (7) | 430 (384) | 619.398 (606.492) | 0,71 (0,65) |
| S | 7/12 (7) | 0/12 (0) | 308 (308) | 57.037 (79.085) | 5,53 (3,99) |
| A | 10/12 (10) | 9/12 (9) | 581 (581) | 637.298 (658.207) | 0,93 (0,90) |

Kein Arm verliert ein Ziel, ein Paket oder Sollzeilen. B gewinnt `flask-pr-6096` durch den
Python-Signaturfix. Dieselben Grenzen gelten: bekannte Fälle, keine Agentenmessung.
[Basis](span-replay-fix-baseline.json), [Skill](span-replay-fix-skill.json), [Additiv](span-replay-fix-additive.json).

## Grenzen und nächster Schritt

- **Bekannte Fälle:** Die zwölf Fälle wurden schon am 8. September verwendet, und die Anhängeregel
  folgt aus dem damaligen Ablehnungsgrund.
- **Keine Agentenmessung:** Der Replay misst weder Agentennutzen noch Laufzeit. Er zeigt nicht, ob ein
  Agent die zusätzlichen Spannen liest, statt die Dateien erneut zu öffnen.
- **Weitere Schritte:** Die Übertragung des Kandidaten A ins Produkt braucht ein eigenes Protokoll mit
  sämtlichen Tests und Gates sowie dem externen Holdout; die Ortsfixes oben sind davon unabhängig. Der Agentenvergleich gegen adaptive `rg`-Suche bleibt
  davon unabhängig offen.

Ergebnisdateien: [Basis](span-replay-baseline.json), [Skill](span-replay-skill.json), [Additiv](span-replay-additive.json).
