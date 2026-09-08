# Regeln einzeln abtragen

2026-09-08. Basis `ef10b97`. Nur Entwicklung: die zwölf unveränderten Fälle aus
`eval-context-program.manifest.json`; keine Bestätigungsfälle und keine Modelle.

Zwei voneinander unabhängige Offline-Kontrollen, keine Produktänderung:

- **BM25-Zusatzscore:** native Kandidaten für Prefix 5 und Erweiterung 50 einmal
  erheben. Kontrolle zieht ausschließlich `ftsScore` vom finalen Score ab;
  Kandidaten, Textcoverage, Retrieval-Boosts und stabile Prefix-Logik bleiben gleich.
  Hypothese: der zusätzliche BM25-Wert verdrängt relevante Treffer.
  Das prüft weder BM25 beim SQL-Pooling noch alle Rankingregeln zusammen.
- **Kontextprioritäten:** nativen Such-/Nachbarpool samt Bereichen einmal erheben.
  Kontrolle nimmt Suchpfade in Suchreihenfolge, anschließend übrige Nachbarn in ihrer
  bestehenden Reihenfolge. Hypothese: finale feste Prioritäten verdrängen Aufgabenbelege.
  Identischer Pool, identische Bereiche; kein neues Chunking und keine neuen Beziehungen.
  Frühere Nachbarprioritäten innerhalb des Builders bleiben bestehen.

Jeweils aktuelle Auswahl als Kontrolle reproduzieren und gegen die öffentliche
Such-/Kontextfunktion prüfen. Zwei Wiederholungen müssen dieselben Ergebnisse liefern.
Die Suchspur liest höchstens acht Dateien, 160 Zeilen ab 40 Zeilen vor dem Treffer;
Kontextspur liest höchstens acht eingefrorene Bereiche. Beide haben 16 KiB Quellbudget,
UTF-8 und ganze Zeilen; beim ersten Budgetüberlauf stoppen statt teure Treffer überspringen.

Metriken: vollständige Zielspannenfälle und Aufgabenpakete, Pfad-Recall@5, MRR,
Quellbytes; Suchspur zusätzlich Top-10-Rangfolge. Fortsetzung je Hebel nur bei mindestens
zwei zusätzlich vollständigen Zielspannenfällen, keinem verlorenen vollständigen Fall,
nicht schlechterem mittleren Recall@5, stabilen Ausgaben und korrekten Quellen/Budgets.
Kein Nachstimmen aus Diagnosen. Neutral bedeutet kein nachgewiesener Nutzen dieses
Hebels; es belegt weder allgemeine Gleichwertigkeit noch Nutzlosigkeit von CodeMap.
Ein qualifizierter Produktkandidat benötigt danach alle bestehenden Gates; hier werden
nur Auswertungswerkzeuge und Ergebnisse committed. Keine Versionsänderung.
