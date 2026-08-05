# Wie der codemap-Index funktioniert

Erklärdokument, deutschsprachig. Es beschreibt, was beim Indexieren passiert und was in der
Datenbank steht. Alle Zahlen stammen aus einer Messung am Repo `codemap` selbst,
Stand 2026-08-06, Commit 945ca32.

Die übrige Dokumentation dieses Repos ist englisch. Dieses Dokument ist bewusst eine Ausnahme
und richtet sich an Leser, die das Verfahren verstehen wollen — nicht an Entwickler, die es
warten. Die technische Referenz bleibt `docs/developer/architecture.md`.

---

## 1. Das Grundprinzip in drei Sätzen

Einmal am Anfang liest codemap alle Dateien des Repos und legt das Ergebnis in einer
Datenbankdatei ab. Bei jeder Suche wird nur noch diese Datei gelesen — keine einzige
Quelldatei wird dafür geöffnet.

Der Zweck davon ist **nicht** in erster Linie Geschwindigkeit (dazu Abschnitt 9), sondern eine
andere Art von Antwort: eine nach Relevanz sortierte Rangfolge statt einer ungeordneten Liste
aller Textfundstellen. Diese Sortierung braucht Statistik über den gesamten Bestand, und die
lässt sich nicht bei jeder Anfrage neu ausrechnen.

Die Datenbank liegt außerhalb des Repos, standardmäßig unter
`~/.local/share/codemap/repos/<hash>.sqlite`. Existiert dieses Verzeichnis nicht, aber das
ältere `~/.pi/agent/state/codemap/`, gewinnt das ältere — auf dieser Maschine ist das der Fall,
weshalb die Datei hier unter `~/.pi/agent/state/codemap/repos/` liegt. `codemap status --json`
nennt den tatsächlichen Pfad im Feld `dbPath`.

Für dieses Repo ist die Datei 3,4 MB groß. Ginge sie verloren, wäre sie in einer drittel Sekunde
neu gebaut — sie enthält nichts, was nicht aus dem Quellcode wiederherstellbar wäre.

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

### files — eine Zeile pro Datei (198 Zeilen)

```
id  path  language  size  hash  mtime_ms  indexed_at
```

Hier steht der Dateipfad genau einmal. Alle anderen Tabellen verweisen nur mit einer Nummer
darauf, statt den Pfad tausendfach zu wiederholen. `hash` und `mtime_ms` dienen dem
Überspringen unveränderter Dateien beim nächsten Lauf.

### chunks — eine Zeile pro Chunk (1.866 Zeilen)

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

### symbols — eine Zeile pro gefundenen Namen (1.393 Zeilen)

```
id  file_id  name  kind  start_line  end_line  signature
```

Eine echte Zeile:

```
id          837
file_id     72          → src/core/indexer.ts
name        indexRepo
kind        function
start_line  10
end_line    null
signature   export function indexRepo(options: { cwd?: string; … })
```

### chunks_fts — der Volltextindex (Sonderfall, siehe Abschnitt 5)

Dazu kommt `symbols_fts` nach demselben Muster für die Namen. `graph_nodes` und `graph_edges`
halten fest, welche Datei welche andere importiert; sie bedienen nicht die Suche, sondern
`codemap context` — Abschnitt 8.

### Wie die Nummern zusammenhängen

Jede Tabelle zählt für sich. Dieselbe Zahl bedeutet in jeder Tabelle etwas anderes:

```
id 46 in files    → die Datei scripts/eval-real-repo-navigation.ts
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

Die praktische Fehlerquelle liegt in der ersten Zeile, nicht in der letzten. Ein Bruchstück
mitten aus einem Namen findet nichts:

```
codemap search RepoStream   → No results
```

Denn im Index steht `scanrepostream` als **ein** Wort; `repostream` kommt dort nicht vor. Wer
nach einem Teilnamen sucht, muss den Anfang treffen: `codemap search scanRepo` liefert
`src/core/scanner.ts` als besten Treffer, `RepoStream` liefert nichts.

Der Unterstrich dagegen schadet nicht. Im Volltextindex passen auf `read_first` 69 Chunks: der
Suchbegriff wird genauso zerlegt wie der Text, und aus den beiden Wörtern wird die Frage „`read`
unmittelbar gefolgt von `first`". Das findet dann allerdings auch `read first` und `read-first`
in Fließtext — die Schreibweise mit Unterstrich ist nach der Zerlegung nicht mehr erkennbar.

### Der Suchbegriff wird stärker zerlegt als der Text

Beim Indexieren trennen Großbuchstaben nicht. Beim Suchen schon: `codemap search openRepoDb`
sucht nach vier Begriffen statt nach einem.

```
Eingabe    openRepoDb
Begriffe   openrepodb, open, repo, db
```

Das ist Absicht und der Grund, warum die Suche auch dann noch etwas findet, wenn man den Namen
nur ungefähr trifft. Es erklärt zugleich, warum bei einer Suche nach einem sehr spezifischen
Namen auch Treffer auftauchen, die nur `db` enthalten — sie stehen dann weit unten, aber sie
stehen da.

### Wort und Symbol sind nicht dasselbe

Am Beispiel `indexRepo` in diesem Repo:

- **als Wort**: in 85 Chunks — überall, wo die Zeichenkette auftaucht: Aufrufe, Kommentare,
  Tests, Changelog.
- **als Symbol**: genau einmal, `src/core/indexer.ts` Zeile 10, Art `function`. Das ist die
  Stelle, an der es definiert wird.

Wörter fallen automatisch an, ohne Auswahl und ohne Bedeutung: 8.052 verschiedene im ganzen
Repo. Symbole sind gezielt gesucht: 1.393 Stück. Deshalb kann codemap einen Treffer auf eine
echte Definition höher bewerten als dasselbe Wort mitten in einem Kommentar — wie viel höher,
steht in Abschnitt 7.

### Was der Volltextindex kostet

| | |
| --- | --- |
| verschiedene Wörter | 8.052 |
| Wort-Vorkommen insgesamt | 159.583 |
| Speicher dafür | 624 KiB |

Macht 4,0 Bytes pro Vorkommen. Der Grund: gespeichert wird nicht jeder Eintrag einzeln, sondern
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
einer, den nur der Chunk-Index kennt. Wie die Rangfolge daraus entsteht, steht in Abschnitt 7.

Weil der Volltextindex auf Chunks zeigt und nicht auf Dateien, ist die Antwort ein
Zeilenbereich, keine Datei. Bei einer 700-Zeilen-Datei ist „steht irgendwo da drin" wertlos;
„Zeile 54–67" ist brauchbar.

## 7. Wie die Rangfolge zustande kommt

Hier steckt die eigentliche Arbeit. Der Abschnitt ist der längste, weil die Rangfolge der
einzige Grund ist, überhaupt einen Index zu bauen (Abschnitt 1).

### Zuerst: bm25 leistet fast nichts

Eine naheliegende Annahme wäre, dass SQLites eingebaute Relevanzformel bm25 die Sortierung
macht. Sie tut es nicht. Der Wert, den bm25 liefert, wird auf höchstens 5 Punkte gedeckelt, und
diese Deckelung greift bei praktisch jedem echten Treffer:

```
Treffer im Volltextindex   → 10 Punkte Grundwert
                           + höchstens 5 Punkte aus bm25
kein Treffer               → 0 Punkte
```

Damit bleibt von bm25 in der Praxis eine Ja/Nein-Auskunft übrig: „dieses Wort kommt vor" — rund
15 Punkte — „oder nicht" — 0. Der Vermerk dazu steht im Code (`src/core/ranking.ts`, ab Zeile
260) und ist ausdrücklich als revidierbar markiert.

Die Rangfolge entsteht stattdessen aus einer Summe von rund einem Dutzend Einzelbeiträgen, die
codemap selbst berechnet.

### Woher ein Kandidat kommt, zählt mit

Bevor überhaupt bewertet wird, sammelt codemap Kandidaten aus sieben Quellen. Jede Quelle gibt
einen Startbonus mit, der ausdrückt, wie belastbar dieser Fund ist:

| Quelle | Startbonus | wofür |
| --- | ---: | --- |
| `basename_term` | 42 | ein Suchwort ist exakt der Dateiname |
| `endpoint_route` | 34 | HTTP-Handler in einer `route.ts` |
| `path_match` | 30 | die Anfrage sieht aus wie ein Pfad und trifft einen |
| `role_intent` | 18 | die Anfrage fragt nach einer Rolle (README, Tests, Konfiguration) |
| `symbol_fts` | Stufe + 4 | Treffer im Namensindex |
| `chunk_fts` | Stufe + 1 | Treffer im Textindex |
| `code_quota` | Stufe + 1 | Rettungsplatz für Quellcode, siehe unten |

„Stufe" ist ein zweiter Bonus, der davon abhängt, **wie genau** die Anfrage getroffen wurde. Aus
einer Anfrage baut codemap mehrere Volltextabfragen, von wörtlich bis großzügig:

| Abfrage | Stufe |
| --- | ---: |
| eine Wortgruppe in Anführungszeichen | 24 |
| alle Wörter der Anfrage, unverändert | 18 |
| alle Wörter ohne Füllwörter | 16 |
| alle Wörter samt der zerlegten Bestandteile | 12 |
| Wortanfänge (`openrepodb*`) | 8 |
| irgendeines der Wörter | 0 |

Die Stufen greifen nur, wenn nach der Zerlegung mehr als ein Suchwort übrig bleibt. Bei einer
Anfrage aus einem einzigen, nicht zerlegbaren Wort sind alle Stufen 0 — es gibt dann nichts
abzustufen.

### Die Summe an einem echten Beispiel

`codemap search openRepoDb` findet als besten Treffer die Definition in `src/core/db.ts`
Zeile 6, mit 109 Punkten. Die setzen sich so zusammen:

| Beitrag | Punkte | warum |
| --- | ---: | --- |
| Herkunft (`symbol_fts` 4 + Stufe 18) | 22 | Namensindex, exakte Wortliste |
| Volltexttreffer | 15 | Grundwert 10 + gedeckelte 5 |
| Symbolwertung | 51 | Name identisch (28) + Suchwort ist der Name (20) + Text enthält die Anfrage (3) |
| Dateiname | 9 | `db` ist der Dateistamm (8) + ein Viertel der Suchwörter im Namen (1) |
| Anfrage steht wörtlich im Text | 4 | |
| Quellcode-Bonus | 6 | Code-Endung (2) + liegt unter `src/` (4) |
| Wortabdeckung im Text | 0,75 | 2 von 4 Suchwörtern gefunden |
| Pfadwertung | 1,25 | |
| **Summe** | **109** | |

Der zweitbeste Treffer — `src/core/graph-store.ts` — kommt auf 51,5. Vom Abstand von 57,5
Punkten stammen 48 aus der Symbolwertung und 9 aus dem Dateinamen. Der Rest ist Rauschen. Denn
in `db.ts` steht `openRepoDb` als *Name* einer Funktion; in `graph-store.ts` steht dasselbe Wort
nur in einer Typangabe, und die Datei heißt auch nicht so.

### Abzüge

Nach unten wirken drei Arten von Abzug: Rauschen (die ersten sechs Zeilen), Tests und
Dokumentation.

| Abzug | Punkte | wann |
| --- | ---: | --- |
| Lockfiles | 60 | immer, außer die Anfrage nennt sie ausdrücklich |
| generierter Code | 60 | dito |
| Build-Ausgaben, minifizierte Dateien | 48 | dito |
| große JSON-Dateien (ab 64 KB) | 36 | dito |
| `AGENTS.md`, `CLAUDE.md` u. ä. | 18 | außer die Anfrage zielt auf Agentenanweisungen |
| archivierte Dokumentation | 14 | außer die Anfrage enthält „archive" |
| Testdateien | 3 bis 8 | bei Anfragen, die nach Implementierung klingen |
| Dokumentation | 6 | bei Anfragen mit eindeutigen Code-Wörtern |

Die 60 Punkte für ein Lockfile sind so bemessen, dass sie jeden denkbaren Bonus überwiegen. Ein
`package-lock.json` kann bei einer Suche nach einem Paketnamen sonst mühelos gewinnen — es
enthält den Namen hunderte Male.

### Der Rettungsplatz für Quellcode

Eine Anfrage in normaler Sprache — „Überblick Lagerbestand Karten" — trifft Prosa besser als
Code. Die Dokumentation enthält genau diese Wörter als saubere Einzelwörter, der Code enthält
sie in Bezeichnern versteckt. Das Ergebnis war messbar: bei einer solchen Anfrage in einem
Fremdrepo blieb von 36 Kandidaten **kein einziger** eine Codedatei.

Die Gegenmaßnahme heißt `code_quota` und ist bewusst additiv: codemap sieht 60 statt der
üblichen Treffer tief in die Rangliste hinein und hebt bis zu 6 Codedateien zusätzlich in den
Kandidatentopf — vorausgesetzt, sie decken mindestens ein Fünftel der Suchwörter ab. Es wird
nichts entfernt und nichts umsortiert; die Dokumentation verliert keinen Platz, der Code bekommt
nur überhaupt einen.

### Was am Ende herausfällt

Kandidaten mit einer Punktzahl von 0 oder weniger fliegen raus, pro Datei bleibt der beste
Chunk, und bei Gleichstand entscheidet der Pfad alphabetisch. Letzteres ist kein Qualitäts-,
sondern ein Reproduzierbarkeitskriterium: dieselbe Anfrage soll zweimal dieselbe Reihenfolge
liefern.

Die vollständigen Regeln samt Testabdeckung stehen in `docs/developer/search-quality.md`; der
Code dazu in `src/core/ranking.ts`, `src/core/search-pipeline.ts` und `src/core/query-plan.ts`.

## 8. Der Importgraph

`graph_nodes` und `graph_edges` beantworten eine Frage, die der Volltextindex nicht beantworten
kann: **welche Datei benutzt welche andere?**

### Was drinsteht

`graph_nodes` enthält im Moment ausschließlich Dateien — eine Zeile pro indexierter Datei, 198
Stück. `graph_edges` enthält die Verbindungen, 252 Stück:

| Art | Anzahl | woher |
| --- | ---: | --- |
| `imports` | 249 | `import`-Zeilen in TypeScript/JavaScript (245) und Python (4) |
| `includes` | 3 | `#include "…"` in C/C++ |

Eine Kante merkt sich mehr als nur „A benutzt B": auch die Zeile, in der der Import steht, den
geschriebenen Verweis (`./db.ts`) und welcher der drei Erkenner ihn gefunden hat.

Erfasst werden **nur repo-interne** Verweise. Ein `import { readFile } from "node:fs"` erzeugt
keine Kante, weil das Ziel nicht im Index steht. Deshalb haben 107 der 198 Dateien keine einzige
ausgehende Kante — Testfixtures, Markdown, Konfiguration und Module, die nur aus der
Standardbibliothek importieren.

### Wozu das gut ist

`codemap context` beantwortet damit die Frage „was muss ich außer dieser Datei noch lesen?".
Für `src/core/graph-store.ts` sieht das so aus:

```
src/core/graph-store.ts        (target)
src/core/db.ts                 (import)
src/core/indexed-source.ts     (import)
src/core/local-references.ts   (import)
src/core/index-store.ts        (reverse_import)
src/core/relationships.ts      (reverse_import)
tests/index-store-deletion-guard.test.ts  (sibling_test)
```

Aus dem Graphen stammen davon nur die Zeilen mit `import` und `reverse_import`; der
`sibling_test` kommt aus einer Namensregel, nicht aus einer Kante. `import` sind die Dateien,
die diese hier benutzt, `reverse_import` die, die sie benutzen. Die Rückrichtung ist die
eigentlich wertvolle: „wer ruft das auf?" ist mit Textsuche mühsam, mit
einer Tabelle trivial. Beide Richtungen sind auf 16 Kanten und danach auf 8 Dateien begrenzt —
ein `db.ts`, das von 16 Stellen importiert wird, soll die Antwort nicht fluten.

### Was fehlt

Der Graph kennt Dateien, keine Funktionen. „Wer ruft `openRepoDb` auf?" beantwortet er nicht —
nur „wer importiert `db.ts`?". Ein Aufrufgraph bräuchte das, worauf codemap bewusst verzichtet:
einen echten Parser (Abschnitt 9).

Gefunden werden die Importe mit sechs regulären Ausdrücken — vier für TypeScript/JavaScript, je
einer für Python und C/C++ —, nicht durch Auflösung des Modulsystems. Ein `import("./db.ts")`
mit fest geschriebenem Pfad wird erfasst; ein über Variablen zusammengesetzter Pfad nicht, weil
der Dateiname erst zur Laufzeit entsteht. `baseUrl` und `paths` aus einer `tsconfig.json` löst
codemap in einfacher Form auf; verkettete `extends`-Ketten und Workspace-Aliasse bleiben offen.
Ein Verweis, der auf keine indexierte Datei zeigt, wird stillschweigend verworfen.

### Wann er neu gebaut wird

Nicht inkrementell. Sobald sich beim Indexieren mindestens eine Datei geändert hat, werden **alle**
Import-Kanten gelöscht und aus dem gespeicherten Dateitext neu aufgebaut. Bei dieser Repo-Größe
kostet das nichts — es steckt in den 0,32 s aus Abschnitt 9 mit drin. Hat sich nichts geändert,
bleibt der Graph unangetastet.

Zusätzlich trägt er eine Versionsnummer: ändert sich das Verfahren, wird beim nächsten Lauf
einmal vollständig neu gebaut, auch wenn keine Datei sich geändert hat.

## 9. Warum das so schnell ist

Gemessen an diesem Repo, jeweils Mittel aus zehn Läufen:

| | |
| --- | --- |
| Vollständiges Indexieren, kalt | 0,32 s — davon ~0,02 s Node-Start, also ~0,30 s echte Arbeit |
| Erneutes Indexieren ohne Änderungen | 0,08 s |
| Umfang | 198 Dateien, 1,16 MB Text, 8 übersprungen |
| Ergebnis | 1.866 Chunks, 1.393 Symbole, 3,4 MB Datenbank |

Pro Datei passiert nur: Datei-Info abfragen, Datei lesen, Prüfsumme bilden, mit regulären
Ausdrücken zerlegen, in die Datenbank schreiben.

Was **nicht** passiert, und das ist der eigentliche Grund für die halbe Sekunde: kein
Syntaxbaum, kein Parser, keine Embeddings, kein Aufruf eines Sprachmodells, kein Netzwerk,
keine Auflösung von Typen, kein Aufrufgraph.

Diese Verzichtsliste ist zugleich die Grenze des Verfahrens. Die Symbolerkennung per regulärem
Ausdruck übersieht Dinge, und der Index weiß nicht, was ein Bezeichner *bedeutet* — nur, wo er
steht.

### Und beim Suchen? Hier ist codemap langsamer als grep

Dieselbe Suche mit drei Werkzeugen, gemessen an diesem Repo, Mittel aus zehn Läufen:

| | |
| --- | --- |
| `grep -rn "openRepoDb(" src/` | 3 ms |
| `ast-grep run -p 'openRepoDb($$$)' -l ts src/` | 21 ms |
| `codemap search openRepoDb` | 95 ms |

Das ist kein Messfehler und soll hier auch nicht schöngeredet werden. Bei 198 Dateien ist der
Index kein Geschwindigkeitsvorteil: das reine Durchsuchen dauert bei dieser Größe ohnehin nur
Millisekunden. codemap ist rund dreißigmal langsamer als `grep`, wovon etwa 20 ms auf den Start
der Node-Laufzeit entfallen und die restlichen ~75 ms auf das Öffnen der Datenbank, die vier
Abfragestufen (Abschnitt 7) und die Bewertung.

Der Index rechnet sich über zwei andere Dinge:

1. **Die Sortierung.** `grep` liefert alle Fundstellen in Dateireihenfolge — bei einem häufigen
   Namen sind das hunderte Zeilen, die man selbst durchsehen muss. codemap liefert eine
   Rangfolge, in der Definition vor Aufruf und Quellcode vor Changelog steht.
2. **Die Größe.** Der Aufwand von `grep` wächst mit der Menge des Textes; der Aufwand einer
   Indexsuche wächst mit der Menge der *Treffer*. Bei kleinen Repos gewinnt `grep`, bei großen
   dreht sich das um. Wo genau der Punkt liegt, ist hier nicht gemessen.

## 10. Wozu die Chunks aus einer einzigen Leerzeile gut sind

550 der 1.866 Chunks haben gar keinen Text — das Feld ist leer, sie kosten zusammen 0 Bytes an
Inhalt. Sie zu entfernen wurde gemessen: die Datenbank blieb danach gleich groß.

Der Grund, sie zu behalten, ist ohnehin nicht der Platz, sondern eine Zusicherung: **jede Zeile
jeder Datei liegt in genau einem Chunk, und die `ordinal`-Nummern laufen lückenlos.** Sobald
man Lücken zuließe, müsste jede Stelle, die aus Chunks wieder Dateiausschnitte zusammensetzt,
mit Löchern umgehen können.

## 11. Warum ast-grep ohne Index auskommt

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

codemap kann Wörter vorberechnen, weil es endlich viele gibt: 8.052 in diesem Repo. Man kann sie
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

## 12. Wo man selbst nachsehen kann

Die Datenbank ist eine gewöhnliche SQLite-Datei und lässt sich direkt öffnen. Den Pfad nennt das
Feld `dbPath` der Statusausgabe (Abschnitt 1 zu den zwei möglichen Orten):

```bash
codemap status --json
```

```bash
sqlite3 "$(codemap status --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["dbPath"])')" "select path, start_line, end_line from chunks join files on files.id = chunks.file_id limit 10"
```

Die Wortliste des Volltextindex ist nicht direkt lesbar. Sichtbar wird sie über eine
Hilfstabelle, die aber in derselben Datei angelegt werden muss — also auf einer Kopie arbeiten,
nicht auf dem Index selbst. So sind die Zahlen aus Abschnitt 5 entstanden:

```bash
cp "$DB" /tmp/index-kopie.sqlite && sqlite3 /tmp/index-kopie.sqlite "create virtual table v using fts5vocab(chunks_fts, 'row'); select term, doc, cnt from v order by cnt desc limit 20"
```

## 13. Offene Punkte

- Der Umschlagpunkt gegenüber `grep` ist nicht gemessen. Dass der Index sich ab einer gewissen
  Repo-Größe auch in der Laufzeit lohnt, ist eine begründete Erwartung (Abschnitt 9), keine
  Messung.
- Die Zahlenwerte in Abschnitt 7 sind aus dem Code abgelesen und an einem Beispiel nachgerechnet,
  aber nicht hergeleitet. Warum eine exakte Symbolübereinstimmung 28 Punkte wert ist und nicht 20
  oder 40, steht nirgends — die Werte wurden über Evals eingestellt, nicht berechnet.
- `codemap context` ist nur so weit beschrieben, wie der Importgraph reicht. Wie die Leseliste
  zusammengestellt und ihr Umfang begrenzt wird, fehlt.
