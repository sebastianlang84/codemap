# CodeMap, rg und pgr: Vergleichsprotokoll

2026-09-08. Auftrag: externe Alternative installieren und vergleichen; keine globale
Umstellung. Ziel ist bessere Agentenarbeit bei gleicher Qualität und vertretbarem Aufwand.
Produktbasis: `3b7a0bc`; pgr: `2e702e6521ef26fe1f4a104ce56dca4531e1d6e4` (MIT).
Rust und pgr bleiben unter `~/.cache/codemap/tool-comparison/` isoliert.

## Lokale Prüfung ohne Modelle

Zwei vor Ausführung eingefrorene Spuren, keine neuen Abfragen nach Ergebnisansicht:

1. Zwölf bestehende Fälle aus `scripts/eval-context-program.manifest.json`, unveränderte
   Queries, Basiscommits und Zielspannen. Profile: aktuelles CodeMap-Search, reine
   Chunk-BM25-Suche, CodeMap-Bewertung desselben BM25-Kandidatenpools, rg und pgr.
2. Zwölf erste inhaltliche rg-Abfragen aus den normalen Armen des aktuellen
   Agentenvergleichs (Läufe 1, 3, …, 23). Profile: rg und pgr. Nur das Regex-Muster
   übernehmen; Dateifilter, Pipes und Leseoperationen entfallen für beide gleich.
   Repo-weite Wiederholung auf dem unveränderten Basisstand, keine Reproduktion des
   damaligen Zwischenstands. Zielpfade stammen aus dem bestehenden Entwicklungsmanifest.

Für Spur 1 liefert CodeMaps unveränderter Query-Plan die Suchbegriffe. BM25 verwendet
sie als einen OR-Ausdruck, rg/pgr als escaped, case-insensitive Regex-Alternativen.
CodeMap erhält die ursprüngliche Query. Diese Spur vergleicht auch Abfrageaufbereitung;
sie allein darf pgr nicht als ungeeignet für adaptive Agenten disqualifizieren.
Spur 2 verwendet dieselbe aufgezeichnete Regex unverändert für beide Werkzeuge.

Alle Werkzeuge sehen dieselben öffentlichen Basisdateien; ihre eigenen Ignore-/Dateityp-
Regeln bleiben erhalten und werden anhand der verfügbaren Zielpfade ausgewiesen.
Keine Referenzpatches oder Bestätigungsfälle lesen. Indexierung isoliert und separat
messen. pgr verwendet unverändert `full_v4`, zehn Dateien und drei Treffer je Datei.
rg liefert zehn Dateien in Pfadreihenfolge, je drei erste Treffer; diese feste Politik
ist eine Suchdiagnose, keine Obergrenze für einen interaktiv suchenden Agenten.

Metriken: MRR des ersten Zielpfads, Zielpfad-Recall@5/@10, vollständiger Zielpfadsatz@5,
Antwortbytes, Laufzeit einschließlich Prozessstart. Fünf Wiederholungen, Medianzeit;
abweichende Rangfolgen als Instabilität melden. Nicht den schnellsten Lauf auswählen.
Quelltextproben: gleicher deterministischer Leser für alle Profile, maximal acht Dateien,
160 Zeilen ab 40 Zeilen vor der ersten gelieferten Position, insgesamt 16 KiB UTF-8;
nur ganze Zeilen, kein Überspringen teurer Dateien. Vollständige Zielspannen und
zugehörige Pfadpräsenz getrennt berichten. Das ist keine native Kontextfunktion.

BM25-Scores nicht zwischen Tabellen oder Query-Tiers mischen. Ein Chunk-FTS-OR-Pool,
Sortierung nach BM25, dann Pfad und Zeile; maximal 500 Kandidaten vor Dateideduplizierung.
Das Kontrollprofil bewertet exakt diesen Pool mit bestehenden CodeMap-Zusatzwerten
und festem Retrieval-Boost 0. Das native CodeMap-Profil bleibt ein separater Vergleich.

## Vorab festgelegte Fortsetzungsregel

pgr wird Kandidat für die Agentenserie, wenn Spur 2 mindestens zwei zusätzliche
vollständige Zielpfadsätze@5 liefert, keinen zuvor vollständigen Satz verliert,
MRR nicht sinkt und Antwortbytes insgesamt höchstens 1,10-mal so hoch sind wie bei rg.

BM25 wird Entwicklungskandidat, wenn es gegenüber der CodeMap-Bewertung desselben
Pools mindestens zwei zusätzliche vollständige Zielspannenfälle im Lesebudget liefert,
keinen vollständigen Fall verliert und Zielpfad-Recall@5 nicht sinkt. Vor einer
Agentenserie braucht ein daraus abgeleiteter Produktpatch sämtliche bestehenden Gates.

Kein Kandidat: Diagnose und Grenzen abschließen, keine Modellserie. Keine Schwellen
nachträglich lockern, keine neue Query- oder Ranking-Abstimmung in dieser Runde.

## Bedingte Agentenserie

Vor Modellstart: Laufzeitprofile ohne Eval-Dateien, vollständige vorab geprüfte
Qualitätskontrolle einschließlich Typprüfung und Aufrufsignaturen bei typisierten APIs.
Vorhandenen Runner erweitern; keine globale MCP-/Skill-Installation für den Versuch.
Detailliertes Manifest und öffentliche Testhilfe vor dem ersten Modellaufruf einfrieren.
Luna medium über vorhandenes Abonnement; gleiche Budgets und wechselnde Reihenfolge.
Maximal zwölf Entwicklungstripel (rg/CodeMap/Kandidat), danach zwölf Bestätigungspaare
nur bei bestandenem Gate: maximal 60 reguläre Aufrufe plus zwei Infrastruktur-Ersatzversuche,
je höchstens 15 Minuten. Keine Wiederholung erfolgloser Aufgaben.

Gate gegenüber jeder Entwicklungs-Kontrolle und erneut in der Bestätigung:
kein Korrektheitsverlust, mindestens 15 % weniger Gesamtzeit, mindestens 8/12-mal
schneller, Tokenverhältnis höchstens 1,10. Index-/Setupkosten und Unsicherheit separat.
Bestätigung gegen die schnellere korrekte Kontrolle; Gleichstand zugunsten rg.
Ein bestandener Versuch ist eine Ersetzungsempfehlung, keine automatische Umstellung.
