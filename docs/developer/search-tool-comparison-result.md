# Suchalternativen: Ergebnis

2026-09-08. **Keine Ersetzung freigegeben.** PGR verbessert die Regex-Trefferauswahl,
überschreitet aber das Antwortbudget. Reines BM25 gewinnt im gleichen Kandidatenpool
netto zwei vollständige Zielspannenfälle, verliert dabei einen bisherigen Erfolg.
Beide verfehlen das [vorab eingefrorene Gate](search-tool-comparison-protocol.md).
Die bedingte Agentenserie wurde deshalb nicht gestartet; Bestätigungsfälle blieben ungeöffnet.

## Messung

24 Fälle, 84 Fall-Profil-Kombinationen, jeweils fünf Wiederholungen: 420 Suchläufe.
Alle Rangfolgen und Antworten stabil, alle gelesenen Quellspannen hashgeprüft.
[Messdaten](search-tool-comparison-result.json) enthalten Reihenfolgen, Positionen,
Hashes, Einzelzeiten, Installationsstand und Gates; Quelltext und Antwortkörper fehlen bewusst.
Die ursprünglichen Rohdaten bleiben im lokalen Cache; ihr Hash steht im Messartefakt.

| Regex-Replay, 12 Fälle | rg | PGR |
|---|---:|---:|
| Alle Zielpfade unter den ersten 5 | 4 | 9 |
| Mittlerer Zielpfad-Recall@5 | 33,3 % | 75,0 % |
| MRR des ersten Zielpfads | 0,128 | 0,451 |
| Antwortbytes gesamt | 19.125 | 27.898 |
| Summe der Medianzeiten | 140 ms | 168 ms |

PGR gewinnt fünf Fälle, verliert keinen vollständigen Fall. Gewinne:
`program-development-02`, `03`, `06`, `09`, `10`.
**45,9 % mehr Antwortbytes statt höchstens 10 %** verhindern die Fortsetzung.
Gemessen wurde das unveränderte PGR-Format `full_v4`, einschließlich Zusammenfassung,
Begründungen und Zeilenformatierung. Bytes sind keine gemessenen Modell-Tokens.

| Begriffssuche, 12 Fälle | CodeMap vollständig | BM25 | CodeMap-Bewertung im gleichen OR-Pool | PGR | rg |
|---|---:|---:|---:|---:|---:|
| Alle Zielpfade unter den ersten 5 | 8 | 5 | 2 | 0 | 0 |
| Mittlerer Zielpfad-Recall@5 | 84,8 % | 62,8 % | 49,4 % | 4,2 % | 0 % |
| Vollständige Zielspannenfälle im Lesebudget | 9 | 5 | 3 | 0 | 0 |
| Zusätzlich alle zugehörigen Pfade gelesen | 6 | 4 | 2 | 0 | 0 |

BM25 und die Bewertungskontrolle hatten in jeder Wiederholung exakt denselben
Kandidatenpool. BM25 gewinnt vollständige Zielspannen bei `fastify-pr-6774`,
`express-pr-4885`, `express-pr-6073`, verliert aber `fastify-pr-6942`.
Das vollständige CodeMap nutzt weitere Retrieval-Schritte und liegt hier vor beiden;
die isolierte Bewertungskontrolle darf nicht als aktuelles Produkt bezeichnet werden.

## Grenzen und Entscheidung

Die Begriffsspur überträgt CodeMaps breite OR-Begriffe auf rg/PGR. Bei rg landen
Dokumentation, Lizenztexte und Beispiele vor den Zieldateien; etwa bei Express beginnen
die Treffer mit `Charter.md` und `Code-Of-Conduct.md`. Der Nullwert ist eine Folge
von Abfrage und Pfadsortierung mit zehn Treffern, kein Urteil über adaptive rg-Nutzung.
Auch das Regex-Replay übernimmt nur das erste historische Muster, entfernt damalige
Dateifilter und berücksichtigt keine anschließende Verfeinerung durch einen Agenten.

Die Zeiten enthalten Prozess-/Adapterstart; Indexaufbau wurde separat erfasst.
Sie belegen weder native Suchleistung allein noch einen Zeitgewinn bei Agentenaufgaben.
Die zwölf historischen Entwicklungsfälle je Spur sind keine unabhängige Bestätigung.

PGR und Rust sind isoliert im Cache installiert; PGR besteht 50 Unit- und 13
Integrationstests. Die Adapter bestehen zwei Node- und acht Python-Tests;
CodeMaps bestehende lokale Prüfungen bestehen mit 313 Tests und allen Mess-Gates.
Produktcode, globale Werkzeugauswahl und MCP-Konfiguration wurden nicht umgestellt.

Ein gesonderter Versuch könnte PGRs Ausgabe kompakter machen. Dafür wären neue
vorab festgelegte Kriterien und frische Fälle nötig; die Schwelle dieser Runde bleibt bestehen.
