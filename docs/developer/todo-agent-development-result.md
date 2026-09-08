# Normale Suche, CodeMap-Suche und Kontext

2026-09-08. **Alle 36 Lösungen korrekt; beide CodeMap-Varianten verfehlen das Effizienz-Gate.**
Die unabhängigen Fälle bleiben geschlossen. Kein weiterer Modelllauf ist freigegeben.

[Protokoll](todo-work-program.md), [Freeze](todo-agent-comparison-freeze.json),
[Messdaten](todo-agent-development-result.json), [Aufrufprüfung](todo-agent-navigation-audit.json).

| Metrik | Normale Suche | CodeMap-Suche | Suche + Kontext |
|---|---:|---:|---:|
| Vollständige Qualität | 12/12 | 12/12 | 12/12 |
| Agentenzeit | 974,3 s | 1.180,0 s | 1.286,2 s |
| Indexierung | 0 s | 5,9 s | 6,4 s |
| Lösungsprüfung | 136,7 s | 147,6 s | 139,8 s |
| Summe dieser Zeiten | 1.111,0 s | 1.333,4 s (+20,0 %) | 1.432,3 s (+28,9 %) |
| Tokens einschließlich Cache | 2.806.680 | 3.940.672 (+40,4 %) | 4.442.088 (+58,3 %) |
| Schnellere Aufgaben als normale Suche | — | 3/12 | 2/12 |
| Befehlsaufrufe | 87 | 114 | 133 |
| Herkömmliche Navigation vor erster protokollierter Dateiänderung | 37 | 48 | 54 |

Beide Varianten erfüllen Adoption (12/12), gültige Paare (12/12), keine Vermischung
der Varianten und keinen Qualitätsverlust. Beide verfehlen sämtliche Effizienzbedingungen:
mindestens 15 % weniger Gesamtzeit, höchstens 10 % mehr Tokens und mindestens acht
schnellere Aufgaben. Alle zwölf Referenzen bestehen die vollständigen Prüfungen.
36 reguläre Modellaufrufe, keine Infrastruktur-Ersatzversuche, keine Timeouts.

## Tatsächliche Navigation

15 Kontextaufrufe sind sichtbar, zehn davon mit auslesbarem JSON-Quelltext.
Vier Aufrufe scheitern an Positionen, die kein indexierter Chunk abdeckt;
ein erfolgreicher Aufruf hat eine leere sichtbare Ausgabe. Deren Ursache ist nicht geklärt.
Die separate [Hostprüfung](todo-host-output-result.md) beweist die vollständige Weitergabe
für ihre geprüften Pi- und Codex-MCP-Aufrufe, nicht für jede mögliche Hostausführung.

Sechs spätere herkömmliche Leseaufrufe enthalten einen zuvor gelieferten Ausschnitt
vollständig erneut, jeweils vor der ersten protokollierten Dateiänderung. Die Prüfung
zählt nur exakte vollständige Wiederholungen mit passendem Pfad; sie beweist weder
unnötiges Lesen noch vermeidbare Zeit. Teilüberlappungen und Shell-Dateiänderungen
sind nicht vollständig erfasst. Sichtbare Navigationsausgabe: 507.110 / 620.071 / 686.738 Bytes.

## Grenzen und Entscheidung

Bekannte Entwicklungsaufgaben, je ein Lauf pro Variante; keine unabhängige Bestätigung.
Angefordert war `gpt-5.6-luna`, medium; die CLI meldet kein tatsächlich antwortendes Modell.
Tokens summieren Eingabe, Ausgabe und Cache. Eine Geldkostenaussage ist nicht möglich.
Die Zeitmetrik enthält Agent, Index und Prüfer; Eval-Vorbereitung und Sandbox-Vorprüfung
sind vorab ausgeschlossen. Deren Summen betragen 30,8/27,9/31,2 s und 11,3/11,6/12,0 s.
Die Variantenreihenfolge rotiert je Aufgabe. Andere Hostjobs liefen parallel;
aufgezeichnete Ein-Minuten-Last: 0,20–1,99 / 0,20–2,88 / 0,24–3,06.
Das begrenzt Zeitvergleiche und erlaubt keine kausale Zerlegung der Mehrzeit.

Kein belegter Zusatznutzen in dieser Serie; daraus folgt keine allgemeine Untauglichkeit.
Die Korrektheitsfixes bleiben erhalten. Kontext- und Regelkandidaten bleiben verworfen;
weitere Versuche brauchen einen neuen reproduzierbaren Befund und ein begrenztes Protokoll.

## Gesamtzeit je Aufgabe

Sekunden einschließlich Index und Lösungsprüfung; IDs entsprechen dem eingefrorenen Manifest.

| Aufgabe | Normale Suche | CodeMap-Suche | Suche + Kontext |
|---|---:|---:|---:|
| 01 | 55,26 | 67,92 | 89,16 |
| 02 | 102,40 | 98,71 | 133,84 |
| 03 | 73,25 | 58,58 | 71,38 |
| 04 | 51,75 | 58,59 | 67,50 |
| 05 | 151,21 | 179,79 | 155,11 |
| 06 | 90,83 | 177,05 | 138,11 |
| 07 | 56,73 | 49,01 | 76,85 |
| 08 | 107,01 | 131,05 | 123,57 |
| 09 | 169,60 | 228,64 | 293,87 |
| 10 | 25,31 | 36,19 | 42,28 |
| 11 | 120,38 | 127,71 | 176,54 |
| 12 | 107,29 | 120,21 | 64,12 |
