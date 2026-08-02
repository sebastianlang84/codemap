# Wie der codemap-Index funktioniert

Erklärdokument, deutschsprachig. Es beschreibt, was beim Indexieren passiert und was in der
Datenbank steht. Alle Zahlen stammen aus einer Messung am Repo `codemap` selbst,
Stand 2026-08-02, Commit cd034dd.

Die übrige Dokumentation dieses Repos ist englisch. Dieses Dokument ist bewusst eine Ausnahme
und richtet sich an Leser, die das Verfahren verstehen wollen — nicht an Entwickler, die es
warten. Die technische Referenz bleibt `docs/developer/architecture.md`.

---

## 1. Das Grundprinzip in drei Sätzen

Einmal am Anfang liest codemap alle Dateien des Repos und legt das Ergebnis in einer
Datenbankdatei ab. Bei jeder Suche wird nur noch diese Datei gelesen — keine einzige
Quelldatei wird dafür geöffnet.

Der Zweck davon ist **nicht** in erster Linie Geschwindigkeit (dazu Abschnitt 7), sondern eine
andere Art von Antwort: eine nach Relevanz sortierte Rangfolge statt einer ungeordneten Liste
aller Textfundstellen. Diese Sortierung braucht Statistik über den gesamten Bestand, und die
lässt sich nicht bei jeder Anfrage neu ausrechnen.

Die Datenbank liegt außerhalb des Repos, unter `~/.local/share/codemap/repos/<hash>.sqlite`.
Für dieses Repo ist sie 2,7 MB groß. Ginge sie verloren, wäre sie in einer halben Sekunde neu
gebaut — sie enthält nichts, was nicht aus dem Quellcode wiederherstellbar wäre.

## 2. Was beim Indexieren passiert

`codemap index` durchläuft folgende Schritte:

1. **Freigabe prüfen.** Ohne vorheriges `codemap index --approve` bricht der Lauf ab. Das
   Indexieren ist rein lokal; nichts verlässt die Maschine, und das Repo wird nicht verändert.
2. **Dateien einsammeln.** Der Scanner läuft durch das Verzeichnis und bleibt dabei innerhalb
   der Git-Repo-Grenze. Übersprungen werden: alles aus `.gitignore` und `.codemapignore`,
   Symlinks, verschachtelte Git-Worktrees, Binärdateien, Dateien, die nach Zugangsdaten
   aussehen, und alles über 1 MB.
3. **Unveränderte Dateien überspringen.** Stimmen Änderungsdatum und Größe mit dem letzten
   Lauf überein, wird die Datei gar nicht erst gelesen.
4. **Jede geänderte Datei verarbeiten** — siehe Abschnitt 3.
5. **Alles in einer einzigen Transaktion schreiben.** Ein Festplatten-Sync für den ganzen Lauf
   statt einem pro Datei.

Gelöschte Dateien fliegen aus dem Index — aber nur, wenn der Durchlauf vollständig war. Bricht
er unterwegs ab (etwa wegen fehlender Leserechte auf ein Verzeichnis), bleiben die bisherigen
Einträge stehen, damit ein vorübergehender Fehler nicht den halben Index löscht.

Es läuft kein Hintergrunddienst. Indexieren passiert nur, wenn man es anstößt.

## 3. Zwei getrennte Auswertungen pro Datei

Aus dem Text einer Datei entstehen **zwei voneinander unabhängige Ergebnisse**. Das ist der
Punkt, an dem eine naheliegende Vorstellung falsch ist: die Symbole werden *nicht* aus den
Chunks abgeleitet, sondern direkt aus dem Dateitext.

```
                    Datei (Text)
                    /          \
          chunkText()          extractSymbols()
               |                     |
          Tabelle chunks       Tabelle symbols
               |                     |
       Volltextindex          Volltextindex
        chunks_fts             symbols_fts
```

Im Code stehen beide Aufrufe direkt untereinander, jeweils auf demselben Rohtext
(`src/core/index-store.ts`, Zeilen 147 und 154).

**`chunkText()`** teilt die Datei in Chunks — zusammenhängende Zeilenbereiche. Der Schnitt
liegt möglichst so, dass eine Funktion am Stück in einem Chunk landet. Das gelingt nur bei
TypeScript, JavaScript und Python; bei allen anderen Sprachen kennt codemap die
Funktionsgrenzen nicht und teilt stumpf alle paar Zeilen auf.

Beispiel `src/core/indexer.ts`:

```
Chunk 0   Zeile  1– 9   kind: text      die Import-Zeilen
Chunk 1   Zeile 10–32   kind: function  indexRepo, vollständig
Chunk 2   Zeile 33–33   kind: text      die Leerzeile dazwischen
Chunk 3   Zeile 34–57   kind: function  status, vollständig
```

**`extractSymbols()`** sucht mit einer Handvoll regulärer Ausdrücke nach Stellen, an denen
etwas definiert wird — Funktionen, Klassen, Markdown-Überschriften. Das ist bewusst grob:
das Verfahren ist ungefähr richtig, nicht garantiert richtig.

## 4. Die Tabellen

Die Datenbank enthält 16 Tabellen, aber nur vier davon muss man kennen. Jede hat sieben
Spalten.

### files — eine Zeile pro Datei (197 Zeilen)

```
id  path  language  size  hash  mtime_ms  indexed_at
```

Hier steht der Dateipfad genau einmal. Alle anderen Tabellen verweisen nur mit einer Nummer
darauf, statt den Pfad tausendfach zu wiederholen. `hash` und `mtime_ms` dienen dem
Überspringen unveränderter Dateien beim nächsten Lauf.

### chunks — eine Zeile pro Chunk (1.843 Zeilen)

```
id  file_id  ordinal  start_line  end_line  kind  text
```

Eine echte Zeile:

```
id          46
file_id     7           → verweist auf files.id = 7
ordinal     0           → der erste Chunk dieser Datei
start_line  1
end_line    31
kind        markdown
text        "# ADR 20260718 — Enforce codemap-first via a …"
```

Diese Tabelle enthält den Quelltext ein zweites Mal. Das ist Absicht: Suchtreffer lassen sich
so anzeigen, ohne eine Datei zu öffnen, und `codemap context` funktioniert auch dann noch,
wenn das Arbeitsverzeichnis inzwischen abweicht.

### symbols — eine Zeile pro gefundenen Namen (1.368 Zeilen)

```
id  file_id  name  kind  start_line  end_line  signature
```

Eine echte Zeile:

```
id          812
file_id     71          → src/core/indexer.ts
name        indexRepo
kind        function
start_line  10
end_line    null
signature   export function indexRepo(options: { cwd?: string; … })
```

### chunks_fts — der Volltextindex (Sonderfall, siehe Abschnitt 5)

Dazu kommen `symbols_fts` nach demselben Muster für die Namen sowie `graph_nodes` und
`graph_edges`, in denen steht, welche Datei welche andere importiert. Letztere bedienen nicht
die Suche, sondern `codemap context`.

### Wie die Nummern zusammenhängen

Jede Tabelle zählt für sich. Dieselbe Zahl bedeutet in jeder Tabelle etwas anderes:

```
id 46 in files    → die Datei scripts/gc-state.ts
id 46 in chunks   → ein Chunk aus Datei 7, Zeile 1–31
id 46 in symbols  → der Name "local development:" in Datei 3, Zeile 156
```

`id` ist immer die Nummer *in dieser* Tabelle. `file_id` ist dagegen kein eigener Zähler,
sondern ein Verweis: „gehört zur Datei, die in `files` unter dieser Nummer steht".

## 5. Der Volltextindex

`chunks_fts` ist eine Tabelle wie die anderen, aber mit einer Besonderheit: sie speichert
keinen Inhalt, sondern nur, **welches Wort in welchem Chunk vorkommt**.

Fragt man sie ab, kommt nur eine Nummer zurück:

```
select rowid, path, text from chunks_fts where chunks_fts match 'scanRepoStream'
→ rowid: 2,  path: null,  text: null
```

`path` und `text` sind als Spalten deklariert, geben aber nichts zurück. Nutzbar ist allein
die Zeilennummer, und die zeigt auf `chunks`. Die Verknüpfung stellt codemap selbst her, über
die Vereinbarung `chunks_fts.rowid = chunks.id`. SQLite erzwingt diese Gleichheit nicht.

Angelegt wird die Tabelle mit `create virtual table … using fts5(…)`. „FTS" steht für
*Full Text Search*, „virtuell" heißt: SQLite reicht jeden Zugriff an ein eingebautes
Zusatzmodul weiter, das die Daten in einem eigenen Format ablegt. Für den Benutzer ändert das
nichts — man fragt mit normalem SQL ab, mit dem Zusatzwort `match`.

### Was zählt als ein Wort?

Der Text wird an allen Zeichen zerlegt, die keine Buchstaben oder Ziffern sind. Groß- und
Kleinschreibung spielt keine Rolle.

| Im Code steht | Daraus werden die Wörter |
| --- | --- |
| `scanRepoStream` | `scanrepostream` — Großbuchstaben trennen nicht |
| `db.exec` | `db`, `exec` — der Punkt trennt |
| `read_first` | `read`, `first` — der Unterstrich trennt |

Die letzte Zeile ist eine praktische Fehlerquelle: eine Suche nach `read_first` liefert null
Treffer, weil es dieses Wort im Index nicht gibt.

### Wort und Symbol sind nicht dasselbe

Am Beispiel `indexRepo` in diesem Repo:

- **als Wort**: in 82 Chunks — überall, wo die Zeichenkette auftaucht: Aufrufe, Kommentare,
  Tests, Changelog.
- **als Symbol**: genau einmal, `src/core/indexer.ts` Zeile 10, Art `function`. Das ist die
  Stelle, an der es definiert wird.

Wörter fallen automatisch an, ohne Auswahl und ohne Bedeutung: 7.491 verschiedene im ganzen
Repo. Symbole sind gezielt gesucht: 1.368 Stück. Deshalb kann codemap einen Treffer auf eine
echte Definition höher bewerten als dasselbe Wort mitten in einem Kommentar.

### Was der Volltextindex kostet

| | |
| --- | --- |
| verschiedene Wörter | 7.491 |
| Wort-zu-Chunk-Einträge insgesamt | 156.884 |
| Speicher dafür | 564 KiB |

Macht 3,6 Bytes pro Eintrag. Der Grund: gespeichert wird nicht jeder Eintrag einzeln, sondern
pro Wort eine sortierte Liste von Chunk-Nummern, und darin nur die Abstände zwischen
aufeinanderfolgenden Nummern — aus `12, 46, 51` wird `12, +34, +5`. Kleine Zahlen brauchen
wenige Bits.

## 6. Was bei einer Suche passiert

```
"scanRepoStream"  →  chunks_fts nachschlagen  →  Chunk-Nummern  →  chunks lesen
                                                                    ↓
                                          src/core/scanner.ts, Zeile 54–67
```

Keine Datei wird geöffnet. Es sind zwei Nachschlagevorgänge in Tabellen, mehr nicht.

Parallel wird `symbols_fts` befragt. Ein Treffer, den beide melden, wird höher bewertet als
einer, den nur der Chunk-Index kennt. Die Sortierregel heißt bm25 und folgt zwei Faustregeln:
ein seltenes Wort wiegt mehr als ein häufiges, und ein kurzer Chunk mit drei Vorkommen wiegt
mehr als ein langer mit einem.

Weil der Volltextindex auf Chunks zeigt und nicht auf Dateien, ist die Antwort ein
Zeilenbereich, keine Datei. Bei einer 700-Zeilen-Datei ist „steht irgendwo da drin" wertlos;
„Zeile 54–67" ist brauchbar.

## 7. Warum das so schnell ist

Gemessen an diesem Repo:

| | |
| --- | --- |
| Vollständiges Indexieren, kalt | 0,65 s — davon ~0,13 s Node-Start, also ~0,5 s echte Arbeit |
| Erneutes Indexieren ohne Änderungen | 0,13 s |
| Umfang | 197 Dateien, ~1,4 MB Text, 8 übersprungen |
| Ergebnis | 1.843 Chunks, 1.368 Symbole, 2,7 MB Datenbank |

Pro Datei passiert nur: Datei-Info abfragen, Datei lesen, Prüfsumme bilden, mit regulären
Ausdrücken zerlegen, in die Datenbank schreiben.

Was **nicht** passiert, und das ist der eigentliche Grund für die halbe Sekunde: kein
Syntaxbaum, kein Parser, keine Embeddings, kein Aufruf eines Sprachmodells, kein Netzwerk,
keine Auflösung von Typen, kein Aufrufgraph.

Diese Verzichtsliste ist zugleich die Grenze des Verfahrens. Die Symbolerkennung per regulärem
Ausdruck übersieht Dinge, und der Index weiß nicht, was ein Bezeichner *bedeutet* — nur, wo er
steht.

### Und beim Suchen? Hier ist codemap langsamer als grep

Dieselbe Suche mit drei Werkzeugen, gemessen an diesem Repo:

| | |
| --- | --- |
| `grep -rn "openRepoDb("` | 21 ms |
| `ast-grep run -p 'openRepoDb($$$)'` | 57 ms |
| `codemap search openRepoDb` | 235 ms |

Das ist kein Messfehler und soll hier auch nicht schöngeredet werden. Bei 197 Dateien ist der
Index kein Geschwindigkeitsvorteil: das reine Durchsuchen dauert bei dieser Größe ohnehin nur
Millisekunden, und codemap zahlt zusätzlich rund 130 ms für den Start der Node-Laufzeit.

Der Index rechnet sich über zwei andere Dinge:

1. **Die Sortierung.** `grep` liefert alle Fundstellen in Dateireihenfolge — bei einem häufigen
   Namen sind das hunderte Zeilen, die man selbst durchsehen muss. codemap liefert eine
   Rangfolge, in der Definition vor Aufruf und Quellcode vor Changelog steht.
2. **Die Größe.** Der Aufwand von `grep` wächst mit der Menge des Textes; der Aufwand einer
   Indexsuche wächst mit der Menge der *Treffer*. Bei kleinen Repos gewinnt `grep`, bei großen
   dreht sich das um. Wo genau der Punkt liegt, ist hier nicht gemessen.

## 8. Wozu die Chunks aus einer einzigen Leerzeile gut sind

551 der 1.843 Chunks bestehen nur aus Leerraum, zusammen 538 Bytes. Sie zu entfernen wurde
gemessen: die Datenbank blieb danach gleich groß, die Ersparnis lag unter der Messauflösung.

Der Grund, sie zu behalten, ist ohnehin nicht der Platz, sondern eine Zusicherung: **jede Zeile
jeder Datei liegt in genau einem Chunk, und die `ordinal`-Nummern laufen lückenlos.** Sobald
man Lücken zuließe, müsste jede Stelle, die aus Chunks wieder Dateiausschnitte zusammensetzt,
mit Löchern umgehen können.

## 9. Warum ast-grep ohne Index auskommt

`ast-grep` ist das zweite Werkzeug, das für Code-Suche empfohlen wird, und es braucht keinerlei
Vorbereitung. Der Grund ist nicht, dass es cleverer wäre — es beantwortet eine **andere Frage**.

| | codemap | ast-grep |
| --- | --- | --- |
| Frage | „Wo ist das Thema X relevant?" | „Wo steht genau dieses Muster?" |
| Antwort | eine Rangliste | eine vollständige Fundliste, ungeordnet |
| Eingabe | ein paar Suchwörter | ein Codemuster mit Platzhaltern |
| Vorbereitung | Index nötig | keine |

### Was ast-grep tut

Es liest bei jedem Aufruf die Dateien frisch ein, baut daraus einen Syntaxbaum im Arbeitsspeicher
und vergleicht das Muster gegen die Knoten dieses Baums. Danach wird der Baum weggeworfen.

Das Muster ist selbst schon die vollständige Frage. `openRepoDb($$$)` heißt: „ein Aufruf von
`openRepoDb`, mit beliebigen Argumenten". Die Antwort ist binär — es passt oder es passt nicht.
Es gibt nichts zu bewerten und keine Rangfolge.

### Warum ein Index nichts brächte

codemap kann Wörter vorberechnen, weil es endlich viele gibt: 7.491 in diesem Repo. Man kann sie
alle einmal aufschreiben.

Muster kann man nicht vorberechnen, weil es unendlich viele gibt. `openRepoDb($$$)`,
`$X.prepare($$$)`, `if ($C) { return $$$ }` — jede denkbare Kombination von Code und Platzhaltern
ist ein mögliches Muster. Ein Index müsste sie alle im Voraus kennen. Deshalb bleibt nur:
bei jedem Aufruf neu parsen.

### Was das praktisch bedeutet

Der Unterschied zu `grep` zeigt sich an einem konkreten Fall. Gesucht: alle **Aufrufe** von
`openRepoDb`.

```
ast-grep run -p 'openRepoDb($$$)' -l ts src/     → 5 Treffer
grep -rn "openRepoDb(" src/                      → 6 Treffer
```

Der sechste Treffer bei `grep` ist `src/core/db.ts:6`:

```ts
export function openRepoDb(dbPath: string): DatabaseSync {
```

Das ist kein Aufruf, sondern die **Definition**. `grep` kann das nicht unterscheiden, weil es nur
Text sieht: die Zeichenkette `openRepoDb(` steht da nun einmal. `ast-grep` unterscheidet es, weil
es im Syntaxbaum den Unterschied zwischen einem Funktionsaufruf und einer Funktionsdeklaration
kennt.

Derselbe Effekt bei `applyIndexUpdate`: `grep` liefert zusätzlich `src/core/index-store.ts:56`,
wo die Signatur über mehrere Zeilen geht. Solche Fälle sind mit einem regulären Ausdruck kaum
sauber zu fassen — und genau da gehört `ast-grep` hin.

### Wann welches Werkzeug

- **codemap** — wenn man ein Thema oder einen Namen sucht und nicht weiß, wo man anfangen soll.
  Liefert eine Rangfolge und den Kontext drumherum.
- **ast-grep** — wenn man die Syntax der gesuchten Stelle genau kennt: Aufrufe mit bestimmten
  Argumenten, bestimmte Verschachtelungen, bestimmte Importformen. Auch für Umschreibungen über
  viele Dateien hinweg.
- **grep** — für alles, was kein Code ist: Logdateien, Konfiguration, reiner Text.

## 10. Wo man selbst nachsehen kann

Die Datenbank ist eine gewöhnliche SQLite-Datei und lässt sich direkt öffnen:

```bash
codemap status --json
```

```bash
sqlite3 ~/.local/share/codemap/repos/<hash>.sqlite "select path, start_line, end_line from chunks join files on files.id = chunks.file_id limit 10"
```

Der Pfad zur Datei steht im Feld `dbPath` der Statusausgabe.

## 11. Offene Punkte

- `graph_nodes` und `graph_edges` sind nur erwähnt, nicht erklärt.
- Die Rangfolge der Suchtreffer ist über die zwei bm25-Faustregeln hinaus nicht beschrieben;
  die vollständigen Regeln stehen in `docs/developer/search-quality.md`.
