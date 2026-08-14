# Wie der codemap-Index funktioniert

Erklärdokument, deutschsprachig. Es beschreibt, was beim Indexieren passiert und was in der
Datenbank steht. Die Zahlen sind am Repo `codemap` selbst gemessen, Stand 2026-08-14, Commit
cf4f501. Zwei Ausnahmen: die Umschlagpunkt-Tabelle in Abschnitt 9 stammt vom 2026-08-06 bei
Commit df73adf, und die 36 Kandidaten in Abschnitt 7 aus einem fremden Repo.

Die übrige Dokumentation dieses Repos ist englisch. Dieses Dokument ist bewusst eine Ausnahme
und richtet sich an Leser, die das Verfahren verstehen wollen — nicht an Entwickler, die es
warten. Die technische Referenz bleibt `docs/developer/architecture.md`.

---

## 1. Das Grundprinzip

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
weshalb die Datei hier unter `~/.pi/agent/state/codemap/repos/` liegt. Sind `CODEMAP_HOME` oder
`XDG_DATA_HOME` gesetzt, schlagen sie beide Vorgaben; `--state-dir` schlägt auch das noch.
`codemap status --json` nennt den tatsächlichen Pfad im Feld `dbPath`.

Ohne Git geht dabei gar nichts: codemap ermittelt das Wurzelverzeichnis mit `git rev-parse
--show-toplevel` und bricht sonst ab — auch beim Suchen. Der `<hash>` im Pfad ist die Prüfsumme
dieses Wurzelverzeichnisses; verschiebt man das Repo, bekommt es eine neue Datei.

Für dieses Repo ist die Datei 3,0 MB groß. Ginge sie verloren, wäre sie in einer drittel Sekunde
neu gebaut — sie enthält nichts, was nicht aus dem Quellcode wiederherstellbar wäre.

## 2. Was beim Indexieren passiert

`codemap index` durchläuft folgende Schritte:

1. **Freigabe prüfen.** Ohne vorheriges `codemap index --approve` bricht der Lauf ab. Das
   Indexieren ist rein lokal; nichts verlässt die Maschine, und das Repo wird nicht verändert.
2. **Dateien einsammeln.** Der Scanner geht den Verzeichnisbaum vom Wurzelverzeichnis des Repos
   abwärts durch. Ein zweiter Checkout desselben Repos (ein Git-Worktree) im Baum bleibt außen
   vor, sonst stünde jedes Symbol doppelt im Index; ein Submodul oder ein fremdes Repo im Baum
   wird dagegen mitindexiert. Übersprungen werden außerdem: Verzeichnisse aus einer fest
   eingebauten Liste (`.git`, `node_modules`, `dist`, `build`, `__pycache__` und zwanzig
   weitere Namen), alles aus `.gitignore` und `.codemapignore`, Dateien mit einer Endung, die
   codemap nicht als Text kennt — es sind 35, weshalb `LICENSE` und `.gitignore` selbst
   herausfallen —, Bilder, Archive und minifizierte Dateien, Symlinks, Binärdateien, Dateien,
   die nach Zugangsdaten aussehen, und alles über 1 MB.
3. **Unveränderte Dateien überspringen.** Stimmen Änderungsdatum und Größe mit dem letzten
   Lauf überein, wird die Datei gar nicht erst gelesen.
4. **Jede geänderte Datei verarbeiten** — siehe Abschnitt 3.
5. **Den Importgraphen neu aufbauen**, sobald mindestens eine Datei neu geschrieben oder eine
   gelöschte aus dem Index entfernt wurde — siehe Abschnitt 8.
6. **Alles in einer einzigen Transaktion schreiben.** Genauer: die Schritte 4 und 5 laufen
   bereits innerhalb dieser Transaktion. Für den ganzen Lauf wird einmal auf die Festplatte
   durchgeschrieben, nicht einmal pro Datei.

Von diesen Regeln greifen in diesem Repo nur drei, zusammen achtmal: fünfmal die
Verzeichnisliste, zweimal die Endungsliste (`LICENSE`, `.gitignore`), einmal die Dateinamensliste
(`budget-renderer.min.js`). Das sind die 8 übersprungenen Dateien aus Abschnitt 9. Bemerkenswert
daran: `dist` steht in der `.gitignore` dieses Repos gar nicht — ohne die eingebaute Liste läge
der gebaute Code im Index. `.codemapignore` ist die einzige Stellschraube, die man selbst in der
Hand hat; sie hat das Format von `.gitignore`, wirkt zusätzlich dazu und greift erst nach den
eingebauten Listen.

Gelöschte Dateien fliegen aus dem Index — aber nur, wenn der Durchlauf vollständig war. Bricht
er unterwegs ab (etwa wegen fehlender Leserechte auf ein Verzeichnis), bleiben die bisherigen
Einträge stehen, damit ein vorübergehender Fehler nicht den halben Index löscht.

Es läuft kein Hintergrunddienst. Indexieren passiert nur, wenn man es anstößt.

## 3. Zwei getrennte Auswertungen pro Datei

Aus dem Text einer Datei entstehen **zwei voneinander unabhängige Ergebnisse**. Das ist der
Punkt, an dem eine naheliegende Vorstellung falsch ist: Die Symbole werden *nicht* aus den
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

Im Code stehen beide Aufrufe direkt untereinander (`src/core/index-store.ts`, Zeilen 127 und
128); die Zerlegung selbst passiert dann in zwei getrennten Funktionen, die beide denselben
Rohtext bekommen (Zeilen 147 und 154).

**`chunkText()`** teilt die Datei in Chunks — zusammenhängende Zeilenbereiche. Wenn möglich,
wird so geschnitten, dass eine Funktion vollständig in einem Chunk landet. Das gelingt nur bei
TypeScript, JavaScript und Python. Markdown wird stattdessen an den Überschriften der Ebenen 1
bis 3 geschnitten — aber erst, wenn seit dem letzten Schnitt mehr als acht Zeilen vergangen
sind, und ein `#` innerhalb eines Codeblocks zählt nicht. Bei allen übrigen Sprachen weiß
codemap nicht, wo eine Funktion anfängt und aufhört, und zerschneidet die Datei stur alle 80
Zeilen, wobei sich zwei benachbarte Blöcke um 10 Zeilen überlappen.

Beispiel `src/core/indexer.ts`:

```
Chunk 0   Zeile  1– 9   kind: text      die Import-Zeilen
Chunk 1   Zeile 10–32   kind: function  indexRepo, vollständig
Chunk 2   Zeile 33–33   kind: text      die Leerzeile dazwischen
Chunk 3   Zeile 34–57   kind: function  status, vollständig
Chunk 4   Zeile 58–58   kind: text      leer — die Stelle hinter dem letzten Zeilenumbruch
```

Die Datei hat 57 Zeilen; der Zeilenumbruch am Ende macht daraus 58 Positionen, und die letzte
ist leer. Zwei der fünf Chunks enthalten damit gar keinen Text: die Leerzeile zwischen den
beiden Funktionen und die Stelle hinter dem Dateiende. Das ist kein Fehler, sondern Absicht —
warum, steht in Abschnitt 10.

**`extractSymbols()`** sucht mit 32 regulären Ausdrücken — Suchmustern, die auf Text passen,
ohne die Sprache zu verstehen — nach Stellen, an denen etwas definiert wird: Funktionen,
Klassen, Markdown-Überschriften. Neun Muster decken TypeScript, JavaScript, Python und Markdown
ab, zwei C und C++, die übrigen einundzwanzig Go, Rust, Java, Kotlin, Ruby und PHP. Das ist
bewusst grob: Das Verfahren ist ungefähr richtig, nicht garantiert richtig.

Wie grob, zeigt ein Beispiel aus Abschnitt 4: Der Name „local development:“ steht in `README.md`
gar nicht als Überschrift, sondern als Kommentarzeile `# local development:` in einem Codeblock.
Das Muster sieht nur das Doppelkreuz am Zeilenanfang; anders als beim Chunken werden Codeblöcke
dabei nicht ausgespart.

## 4. Die Tabellen

Die Datenbank enthält 16 Tabellen, aber nur vier davon muss man kennen. Die ersten drei haben je
sieben Spalten; die vierte, der Volltextindex, ist ein Sonderfall (Abschnitt 5).

### files — eine Zeile pro Datei (198 Zeilen)

```
id  path  language  size  hash  mtime_ms  indexed_at
```

Hier steht der Dateipfad genau einmal. `chunks`, `symbols` und `graph_edges` verweisen nur mit
einer Nummer darauf, statt den Pfad tausendfach zu wiederholen; `graph_nodes` führt ihn noch
einmal mit — das sind 198 Zeilen und fällt nicht ins Gewicht. `size` und `mtime_ms` entscheiden
beim nächsten Lauf, ob die Datei überhaupt gelesen wird; `hash` entscheidet danach, ob die
gelesene Datei wirklich neu geschrieben werden muss.

### chunks — eine Zeile pro Chunk (1.884 Zeilen)

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

### symbols — eine Zeile pro gefundenen Namen (1.413 Zeilen)

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

Vier Spalten statt sieben: `path`, `language`, `kind`, `text`. Keine davon gibt beim Lesen etwas
zurück — warum, steht in Abschnitt 5.

Dazu kommt `symbols_fts` nach demselben Muster für die Namen. Damit sind die Tabellen der Suche
vollzählig. `graph_nodes` und `graph_edges` halten fest, welche Datei welche andere importiert;
sie bedienen nicht die Suche, sondern `codemap context` — Abschnitt 8.

### Wie die Nummern zusammenhängen

Jede Tabelle zählt für sich. Dieselbe Zahl bedeutet in jeder Tabelle etwas anderes:

```
id 46 in files    → die Datei scripts/eval-real-repo-navigation.ts
id 46 in chunks   → ein Chunk aus Datei 7, Zeile 1–31
id 46 in symbols  → der Name "local development:" in Datei 3, Zeile 156
```

`id` ist immer die Nummer *in dieser* Tabelle. `file_id` ist dagegen kein eigener Zähler,
sondern ein Verweis: „gehört zur Datei, die in `files` unter dieser Nummer steht“.

## 5. Der Volltextindex

`chunks_fts` ist eine Tabelle wie die anderen, aber mit einer Besonderheit: Sie speichert
keinen Inhalt, sondern nur, **welches Wort in welchem Chunk vorkommt**.

Fragt man sie ab, kommen nur Nummern zurück:

```
select rowid, path, text from chunks_fts where chunks_fts match 'scanRepoStream'
→ rowid: 2,     path: null,  text: null
  rowid: 86,    path: null,  text: null
  … acht weitere Zeilen, alle mit path: null und text: null
```

`path` und `text` sind als Spalten deklariert, geben aber nichts zurück. Nutzbar ist allein
die Datensatznummer `rowid`, und die zeigt auf `chunks`. Die Verknüpfung stellt codemap selbst her, über
die Vereinbarung `chunks_fts.rowid = chunks.id`. SQLite erzwingt diese Gleichheit nicht.

Angelegt wird die Tabelle mit `create virtual table … using fts5(…)`. „FTS“ steht für
*Full Text Search*, „virtuell“ heißt: SQLite reicht jeden Zugriff an ein eingebautes
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

Der Unterstrich dagegen schadet nicht. Eine Suche nach `read_first` findet 69 Chunks: Die
Anfrage wird genauso zerlegt wie der Text, und aus den beiden Wörtern wird die Frage „`read`
unmittelbar gefolgt von `first`“. Das findet dann allerdings auch `read first` und `read-first`
in Fließtext — die Schreibweise mit Unterstrich ist nach der Zerlegung nicht mehr erkennbar. In
diesem Repo sind es sogar fast nur solche Fundstellen: 65 der 69 Chunks enthalten `read-first`,
sechs `read first` und nur vier den Unterstrich; einzelne enthalten mehrere Schreibweisen.

### Die Anfrage wird stärker zerlegt als der Text

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

Wörter fallen automatisch an, ohne Auswahl und ohne Bedeutung: 8.807 verschiedene im ganzen
Repo. Symbole sind gezielt gesucht: 1.413 Stück. Deshalb kann codemap einen Treffer auf eine
echte Definition höher bewerten als dasselbe Wort mitten in einem Kommentar — wie viel höher,
steht in Abschnitt 7.

### Was der Volltextindex kostet

| | |
| --- | --- |
| verschiedene Wörter | 8.807 |
| Wort-Vorkommen insgesamt | 165.513 |
| Speicher dafür | 700 KiB |

Macht 4,3 Bytes pro Vorkommen. Der Grund: Gespeichert wird nicht jeder Eintrag einzeln, sondern
pro Wort eine sortierte Liste von Chunk-Nummern, und darin nur die Abstände zwischen
aufeinanderfolgenden Nummern — aus `12, 46, 51` wird `12, +34, +5`. Kleine Zahlen brauchen
wenige Bits.

Gemessen ist damit nur `chunks_fts`. Der Volltextindex der Symbole kostet weitere 132 KiB — er
hat weniger zu verzeichnen, weil in ihm nur Namen und Signaturen stehen.

## 6. Was bei einer Suche passiert

```
"scanRepoStream"  →  chunks_fts nachschlagen   →  Chunk-Nummern   →  chunks lesen
                                                                        ↓
                                                 src/core/scanner.ts, Zeile 54–67

                  →  symbols_fts nachschlagen  →  Symbol-Nummern  →  symbols lesen
                                                                        ↓
                                                 src/core/scanner.ts, Zeile 60
```

Keine Datei wird geöffnet — nachgeschlagen wird nur in Tabellen. Für `scanRepoStream` sind das
acht Abfragen: je eine im Text- und im Namensindex, und das für jede der vier Abfragestufen, die
diese Anfrage auslöst (Abschnitt 7 nennt sieben mögliche; hier greifen vier). Die beiden
Indizes heißen ab hier kurz **Textindex** (`chunks_fts`) und **Namensindex** (`symbols_fts`).

Im Beispiel melden beide dieselbe Datei. Ein Treffer aus dem Namensindex zählt dabei mehr als
einer, der nur im Textindex steht: Er startet mit einem höheren Bonus und kann zusätzlich die
Symbolwertung einsammeln. Addiert wird nichts — von zwei Kandidaten derselben Datei bleibt
schlicht der höher bewertete stehen, hier Zeile 60 mit 98,75 Punkten gegen den Chunk 54–67 mit
45,5. Wie die Rangfolge daraus entsteht, steht in Abschnitt 7.

Ausgegeben wird also nur der bessere der beiden Zweige: `codemap search scanRepoStream`
antwortet mit `src/core/scanner.ts:60`, der Zeile, in der die Funktion definiert wird. Weil
beide Indizes auf Zeilen zeigen und nicht auf Dateien, ist die Antwort ein Ort in der Datei. Bei
einer 700-Zeilen-Datei ist „steht irgendwo da drin“ wertlos; „Zeile 60“ ist brauchbar.

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

Damit bleibt von bm25 in der Praxis nur eine Ja/Nein-Auskunft: Kommt das Wort vor, gibt es rund
15 Punkte; kommt es nicht vor, 0. Bei der Anfrage `openRepoDb` haben alle 80 Kandidaten denselben
Beitrag von 15 Punkten. Ein Kommentar im Code (`src/core/ranking.ts`, ab Zeile 260) hält das fest
und sagt dazu, dass diese Entscheidung überprüft werden kann.

Die Rangfolge entsteht stattdessen aus einer Summe von rund einem Dutzend Einzelbeiträgen, die
codemap selbst berechnet.

### Woher ein Kandidat kommt, zählt mit

Bevor überhaupt bewertet wird, sammelt codemap Kandidaten aus sieben Quellen. Jede Quelle gibt
einen Startbonus mit, der ausdrückt, wie belastbar dieser Fund ist:

| Quelle | Startbonus | wofür |
| --- | ---: | --- |
| `basename_term` | 42 | eine im Code hinterlegte Liste ordnet einem Suchwort einen Dateinamen zu, und eine Datei heißt genau so |
| `endpoint_route` | 34 | ein HTTP-Handler unter `app/api/…/route.ts`, und nur, wenn die Anfrage das Wort `endpoint` und daneben ein Wort aus dem Pfad enthält |
| `path_match` | 30 | die Anfrage sieht aus wie ein Pfad und trifft einen |
| `role_intent` | 18 | die Anfrage fragt nach einer Rolle (README, Tests, Konfiguration) |
| `symbol_fts` | Stufe + 4 | Treffer im Namensindex |
| `chunk_fts` | Stufe + 1 | Treffer im Textindex |
| `code_quota` | Stufe + 1 | Rettungsplatz für Quellcode, siehe unten |

Drei Dinge stehen so nicht in der Tabelle. `basename_term` greift seltener, als es klingt: Die
Ersetzungsliste dahinter hat zur Zeit einen einzigen Eintrag (`preload` → `retrieval`). Dass ein
Suchwort selbst der Dateistamm ist, wirkt anderswo — 8 Punkte in der Dateinamenwertung. Die
oberen vier Quellen holen ihre Kandidaten nicht aus dem Volltextindex, sondern aus `files` und
`symbols`; sie bekommen deshalb auch keine der 15 Volltextpunkte, ihr Startbonus ist alles. Und
der Bonus von `symbol_fts` ist ein Höchstwert: Passt die Anfrage nur auf die Signatur, sinkt er
um bis zu 3 Punkte.

„Stufe“ ist ein zweiter Bonus. Er hängt davon ab, wie wörtlich die Volltextabfrage war, die den
Treffer gefunden hat: je wörtlicher, desto höher. Aus einer Anfrage baut codemap mehrere
Volltextabfragen, von wörtlich bis großzügig:

| Volltextabfrage | Stufe |
| --- | ---: |
| eine Wortgruppe in Anführungszeichen | 24 |
| alle Wörter der Anfrage, unverändert | 18 |
| alle Wörter samt ihrer zerlegten Bestandteile, ohne Füllwörter | 16 |
| ein im Code hinterlegtes Wortpaar (`session` zusammen mit `repo`) | 14 |
| dieselbe Liste wie bei 16, aber mit den Füllwörtern | 12 |
| Wortanfänge (`openrepodb*`) | 8 |
| irgendeines der Wörter | 0 |

Die Zeile mit 14 Punkten ist ein Sonderfall: Sie entsteht nur, wenn `session` und `repo` beide
unter den Suchwörtern sind.

Die Stufen greifen nur, wenn nach der Zerlegung mehr als ein Suchwort übrig bleibt oder die
Anfrage eine Wortgruppe in Anführungszeichen enthält. Ein einzelnes, nicht zerlegbares Wort
bekommt durchweg Stufe 0 — es gibt dann nichts abzustufen.

### Die Summe an einem echten Beispiel

`codemap search openRepoDb` findet als besten Treffer die Definition in `src/core/db.ts`
Zeile 6, mit 109 Punkten. Die setzen sich so zusammen:

| Beitrag | Punkte | warum |
| --- | ---: | --- |
| Herkunft (`symbol_fts` 4 + Stufe 18) | 22 | Treffer im Namensindex, Stufe „alle Wörter der Anfrage, unverändert“ |
| Volltexttreffer | 15 | Grundwert 10 + gedeckelte 5 |
| Symbolwertung | 51 | Symbolname ist genau die Anfrage (28) + ein Suchwort ist genau der Symbolname (20) + die Anfrage steht wörtlich in der Signatur (3) |
| Dateiname | 9 | `db` ist der Dateistamm (8) + ein Viertel der Suchwörter im Namen (1) |
| Anfrage steht wörtlich im Text | 4 | denselben Fund gibt es noch einmal ohne die Bedingung, dass der Treffer ein Symbol ist |
| Quellcode-Bonus | 6 | Code-Endung (2) + liegt unter `src/` (4) |
| Wortabdeckung im Text | 0,75 | 1 von 4 Suchwörtern steht im Text des Treffers |
| Pfadwertung | 1,25 | |
| **Summe** | **109** | |

Die vier Suchwörter sind `openrepodb`, `open`, `repo` und `db` — die Zerlegung aus Abschnitt 5.
Als eigenes Wort steht davon nur `openrepodb` in der Signatur: `open` und `repo` stecken darin
fest, `db` kommt nur in `dbPath` vor. Über Pfad, Text und Symbolnamen zusammen sind es zwei von
vier, aber in die Wortabdeckung geht allein der Text ein.

Auf Rang 2 folgen sechs Treffer mit je 51,5 Punkten. Welcher davon den zweiten Platz bekommt,
entscheidet nicht die Bewertung, sondern der Pfad: `src/core/architecture-report.ts` steht
alphabetisch vorn, `src/core/graph-store.ts` liegt punktgleich auf Rang 4. Das ist die
Gleichstandsregel vom Ende dieses Abschnitts in freier Wildbahn.

Der Abstand von 57,5 Punkten ist bei allen sechs derselbe: 48 Punkte stammen aus der
Symbolwertung, 9 aus dem Dateinamen, der Rest fällt nicht ins Gewicht. Denn in `db.ts` steht
`openRepoDb` als *Name* einer Funktion; in den sechs anderen Dateien steht dasselbe Wort nur in
einer Typangabe, und keine von ihnen heißt so.

### Abzüge

Nach unten wirken drei Arten von Abzug: uninteressante Dateien (die ersten sechs Zeilen der
Tabelle unten), Tests und Dokumentation.

| Abzug | Punkte | wann |
| --- | ---: | --- |
| Lockfiles | 60 | immer; nennt die Anfrage ein Lockfile ausdrücklich, entfällt der Abzug ganz |
| generierter Code | 60 | immer; zeigt die Anfrage als Pfad darauf, bleiben 8 Punkte |
| Build-Ausgaben, minifizierte Dateien | 48 | immer; zeigt die Anfrage als Pfad dorthin, bleiben 12 Punkte |
| große JSON-Dateien (ab 64 KB) | 36 | immer; nennt die Anfrage `.json`, bleiben 12 Punkte |
| `AGENTS.md`, `CLAUDE.md` u. ä. | 18 | außer die Anfrage zielt auf Agentenanweisungen |
| archivierte Dokumentation | 14 | außer die Anfrage enthält „archive“ |
| Testdateien | 8 oder 3 | 8, wenn die Anfrage nach der Implementierung fragt und nicht zugleich nach Tests; 3, wenn sie eines von dreizehn Code-Wörtern enthält (`function`, `handler`, `pipeline`, `service` …) |
| Dokumentation | 6 | bei Anfragen mit eindeutigen Code-Wörtern |

Vollständig freigestellt wird nur das Lockfile; bei den drei folgenden bleibt auch bei
ausdrücklicher Nennung ein Rest stehen. Und die Abzüge schließen einander nicht aus, sie addieren
sich: Das `package-lock.json` dieses Repos ist 80.099 Bytes groß und verliert deshalb 96 Punkte —
60 als Lockfile, 36 als große JSON-Datei. So bemessen sind sie, weil ein `package-lock.json` bei
einer Suche nach einem Paketnamen sonst mühelos gewinnt: Es enthält den Namen hunderte Male.

### Der Rettungsplatz für Quellcode

Eine Anfrage in normaler Sprache — „Überblick Lagerbestand Karten“ — trifft Prosa besser als
Code. Die Dokumentation enthält genau diese Wörter als saubere Einzelwörter, der Code enthält
sie in Bezeichnern versteckt. Das Ergebnis war messbar: Bei einer solchen Anfrage in einem
Fremdrepo war von 36 Kandidaten **kein einziger** eine Codedatei.

Die Gegenmaßnahme heißt `code_quota` und ist bewusst additiv. Für sie schaut codemap 60 Treffer
tief in die Trefferliste aus SQLite hinein — deutlich tiefer als für die Antwort selbst — und
nimmt daraus bis zu 6 Chunks aus Codedateien zusätzlich in die Kandidatenliste auf,
vorausgesetzt, sie decken mindestens ein Fünftel der Suchwörter ab. Das geschieht je Abfragestufe
erneut, bei vier Stufen also bis zu 24 Mal, mehrfach auch aus derselben Datei. Es wird nichts
entfernt und nichts umsortiert; die Dokumentation verliert keinen Platz, der Code bekommt nur
überhaupt einen.

### Was am Ende herausfällt

Kandidaten mit einer Punktzahl von 0 oder weniger fliegen raus, pro Datei bleibt der
bestbewertete Kandidat — je nach Quelle ein Chunk, ein Symbol oder die Datei selbst —, und bei
Gleichstand entscheidet der Pfad alphabetisch. Letzteres ist kein Qualitäts-, sondern ein
Reproduzierbarkeitskriterium: Dieselbe Anfrage soll zweimal dieselbe Reihenfolge liefern.

Vollständig stehen die Regeln nur im Code: `src/core/ranking.ts` enthält die Punktwerte,
`src/core/search-pipeline.ts` die sieben Quellen, `src/core/query-plan.ts` die Abfragestufen.
`docs/developer/architecture.md` fasst die Signale in Worten zusammen, und
`docs/developer/search-quality.md` beschreibt, welche Regeln durch Tests abgesichert sind und wie
die Suchqualität gemessen wird — Punktwerte nennt keines der beiden Dokumente.

### Woher die Punktwerte stammen

Die Zahlen dieses Abschnitts sind gesetzt, nicht ausgerechnet. Die 28 Punkte für eine exakte
Symbolübereinstimmung entstanden am 9. Mai 2026 als 8 Punkte (Commit `3149a83`, damals gab es im
Repo noch keine Messreihe für Suchqualität) und wurden am 23. Mai auf 28 gehoben — im selben
Commit `26a5ea1`, der den Real-Repo-Eval anlegte. Warum 28 und nicht 20 oder 40, steht nirgends:
Die Commit-Nachricht ist eine Zeile, und weder CHANGELOG noch ADRs noch die Eval-Dokumente halten
Vorher/Nachher-Zahlen fest.

Nachgemessen am 14. August 2026 auf einer Repo-Kopie: Setzt man den Wert nacheinander auf 0, 8,
14, 20, 28, 40 und 60, ändert sich am Ergebnis nichts — alle Tests grün, alle Gates grün, der
Real-Repo-Eval jedes Mal mit denselben Zahlen. Setzt man alle drei Symbolbeiträge gleichzeitig
auf 0, steigt die Erfolgsquote der reinen Suche sogar von 0,500 auf 0,625.

Der Grund steckt in der Bauart: Der Beitrag trifft jeden Kandidaten mit demselben Symbolnamen
gleich und verschiebt damit das ganze Feld, nicht die Reihenfolge darin. Im Beispiel oben liegen
48 Punkte Abstand allein in der Symbolwertung; ob dort 28 stehen oder 0, dreht daran nichts. Das
heißt nicht, dass die Änderung im Mai wirkungslos war — damals bewegten sich vier Werte
gleichzeitig. Es heißt: Keine heute vorhandene Messreihe kann die Höhe dieser Zahl begründen.

## 8. Der Importgraph — und was `codemap context` daraus macht

`graph_nodes` und `graph_edges` beantworten eine Frage, die der Volltextindex nicht beantworten
kann: **welche Datei benutzt welche andere?**

### Was drinsteht

`graph_nodes` enthält im Moment ausschließlich Dateien — eine Zeile pro indexierter Datei, 198
Stück. `graph_edges` enthält die Verbindungen, 252 Stück:

| Art | Anzahl | woher |
| --- | ---: | --- |
| `imports` | 249 | `import`-Zeilen in TypeScript/JavaScript (245) und Python (4) |
| `includes` | 3 | `#include "…"` in C/C++ |

Eine Kante merkt sich mehr als nur „A benutzt B“: auch die Zeile, in der der Import steht, den
geschriebenen Verweis (`./db.ts`) und welcher Erkennungsausdruck ihn gefunden hat. Die Spalte
`extractor` hält dafür einen von drei Werten fest: `ts-js-local-import-regex`,
`python-relative-import-regex` oder `cpp-include-regex`.

Erfasst werden **nur repo-interne** Verweise. Ein `import { readFile } from "node:fs"` erzeugt
keine Kante, weil das Ziel nicht im Index steht. Deshalb haben 107 der 198 Dateien keine einzige
ausgehende Kante — Testfixtures, Markdown, Konfiguration und Module, die nur aus der
Standardbibliothek importieren.

### Wozu das gut ist

`codemap context` beantwortet damit die Frage „was muss ich außer dieser Datei noch lesen?“.
Für `src/core/graph-store.ts` sieht das so aus:

```
src/core/graph-store.ts:1-14   [text] (target)
src/core/db.ts:1-5             [text] (import)
src/core/indexed-source.ts:1-19 [text] (import)
tests/index-store-deletion-guard.test.ts:1-12 [text] (sibling_test)
src/core/index-store.ts:1-37   [text] (reverse_import)
tests/fixtures/context-quality/README.md:1-4 [markdown] (related_doc)
src/core/local-references.ts:1-13 [text] (import)
src/core/relationships.ts:1-77 [text] (reverse_import)
```

Hinter jedem Pfad stehen der Zeilenbereich und die Art des ersten Chunks dieser Datei — der
Einstieg, den codemap vorschlägt. Aus dem Graphen stammen nur die Zeilen mit `import` und
`reverse_import`; `sibling_test` und `related_doc` kommen aus Regeln über Namen und Pfade, nicht
aus einer Kante. `import` sind die Dateien, die diese hier benutzt, `reverse_import` die, die sie
benutzen. Die Rückrichtung ist die eigentlich wertvolle: „wer ruft das auf?“ ist mit Textsuche
mühsam, mit einer Tabelle trivial.

Beide Richtungen werden dabei zweimal begrenzt: Zuerst liest codemap je Richtung höchstens 16
Kanten, davon bleiben höchstens 8 Dateien in der Antwort. `src/core/db.ts` wird von genau 16
Dateien importiert, `src/core/indexer.ts` sogar von 24 — ohne diese Grenze würde eine einzige
solche Datei die ganze Antwort belegen. Wonach die 16 ausgewählt werden, ist allerdings nicht die
Wichtigkeit: In der Rückrichtung sortiert codemap die Importeure alphabetisch nach Pfad und
schneidet dann ab. Bei `src/core/indexer.ts` erreichen acht der 24 die Bewertung nie, weil vor
ihnen acht `scripts/`-Dateien im Alphabet stehen.

### Was fehlt

Der Graph kennt Dateien, keine Funktionen. „Wer ruft `openRepoDb` auf?“ beantwortet er nicht —
nur „wer importiert `db.ts`?“. Ein Aufrufgraph bräuchte das, worauf codemap bewusst verzichtet:
einen echten Parser — ein Programm, das Code nach den Regeln der Programmiersprache zerlegt,
statt nur Zeichen zu vergleichen. Was dabei entsteht, heißt Syntaxbaum: die Datei als Baum aus
Anweisungen, Aufrufen und Deklarationen (Abschnitt 9).

Gefunden werden die Importe mit sechs regulären Ausdrücken — vier für TypeScript/JavaScript, je
einer für Python und C/C++ —, nicht durch Auflösung des Modulsystems. Ein `import("./db.ts")`
mit fest geschriebenem Pfad wird erfasst; ein über Variablen zusammengesetzter Pfad nicht, weil
der Dateiname erst zur Laufzeit entsteht. `baseUrl` und `paths` aus einer `tsconfig.json` löst
codemap in einfacher Form auf; `extends` wertet es gar nicht aus, Workspace-Aliasse ebenso wenig.
Ein Verweis, der auf keine indexierte Datei zeigt, wird stillschweigend verworfen.

### Wann er neu gebaut wird

Nicht Stück für Stück. Sobald sich beim Indexieren mindestens eine Datei geändert hat — oder eine
gelöschte aus dem Index fliegt —, werden **alle** Import-Kanten gelöscht und aus dem gespeicherten
Dateitext neu aufgebaut. Bei dieser Repo-Größe kostet das nichts; es steckt in den 0,32 s aus
Abschnitt 9 mit drin. Hat sich nichts geändert und ist nichts weggefallen, bleibt der Graph
unangetastet.

Zusätzlich trägt er eine Versionsnummer: Ändert sich das Verfahren, wird der Graph beim nächsten
Lauf einmal vollständig neu gebaut, auch wenn sich keine Datei geändert hat.

### Wie die Leseliste zusammengestellt wird

`codemap context <pfad>` gibt eine feste Zahl von Einträgen aus — voreingestellt acht, erlaubt
sind 1 bis 25. Zuerst wird das Ziel bestimmt: gesucht wird in `files` nach einem Pfad, der genau
passt oder den eingegebenen Text enthält; passt keiner, fällt der Befehl auf eine gewöhnliche
Suche zurück, und dann gibt es überhaupt keine Nachbarn.

Die Nachbarn tragen dreizehn mögliche Gründe, und jede Zeile der Ausgabe nennt ihren in Klammern.
Aus dem Graphen kommen nur vier davon: `import` und `include` für Dateien, die das Ziel benutzt,
`reverse_import` und `reverse_include` für die Gegenrichtung. Alles andere sind Namens- und
Verzeichnisregeln — `sibling_test`, `test_of` und `reverse_test` rund um Testdateien,
`implementation_pair` für `.h`/`.c` und Next.js-Routen, `near_config` und `same_dir` für den
Ordner, `related_doc` für die passende Markdown-Datei. Eine Zeile kann mehrere Gründe tragen.

Die Grenzen greifen dreifach hintereinander: je Richtung höchstens 16 Kanten, daraus je Richtung
höchstens 8 Dateien, am Ende 8 Einträge insgesamt. Auf jeder Stufe fliegt heraus, was als
Rauschen gilt — dieselben Dateiarten, die in Abschnitt 7 die hohen Abzüge bekommen.

**Die Reihenfolge ist fest verdrahtet** und hängt an keiner Punktzahl: erst die Zieldatei, dann
die ersten beiden Importe, Implementierungspaare, der namensverwandte Test, die Tests der ersten
Importe und Importeure, der erste übrige Importeur, Konfiguration und Dokument, dann alle
restlichen Importe und Importeure, zuletzt Nachbarn aus demselben Verzeichnis. In der Ausgabe
oben sieht man es: Der dritte Import steht erst auf Platz sieben, hinter dem Test eines
Importeurs und hinter dem verwandten Dokument.

Reicht das Budget nicht, wird von hinten abgeschnitten. `src/core/db.ts` wird von 16 Dateien
importiert; acht überstehen die Deckelung, fünf erscheinen in der Ausgabe. Die Antwort auf „wer
benutzt das?“ ist bei einer viel benutzten Datei also bewusst unvollständig — ein Einstieg, keine
Liste. Reicht es dagegen aus, füllen weitere Chunks der Zieldatei den Rest.

Pro Nachbardatei kommt nur ihr erster Chunk. Ein Tokenbudget gibt es nicht; die einzige Kürzung
ist die Textvorschau nach 700 Zeichen. Die Zeilen `tests:` und `docs:` am Ende gehören nicht zu
den acht Einträgen, sie zählen nur namensverwandte Pfade auf.

## 9. Warum das so schnell ist

Am Repo `codemap` selbst gemessen, Mittel aus zehn Läufen; der kalte Wert aus drei:

| | |
| --- | --- |
| Vollständiges Indexieren, kalt | 0,32 s — davon 0,26 s die eigentliche Indexarbeit, der Rest Prozessstart und Modulladen |
| Erneutes Indexieren ohne Änderungen | 0,08 s |
| Umfang | 198 Dateien, 1,20 MB Text, 8 übersprungen |
| Ergebnis | 1.884 Chunks, 1.413 Symbole, 3,0 MB Datenbank |

Pro Datei passiert nur: Datei-Info abfragen, Datei lesen, Prüfsumme bilden, mit regulären
Ausdrücken zerlegen, in die Datenbank schreiben.

Was **nicht** passiert, und das ist der eigentliche Grund für die drittel Sekunde: kein
Syntaxbaum, kein Parser, keine Embeddings, kein Aufruf eines Sprachmodells, kein Netzwerk,
keine Auflösung von Typen, kein Aufrufgraph.

Diese Verzichtsliste ist zugleich die Grenze des Verfahrens. Die Symbolerkennung per regulärem
Ausdruck übersieht Dinge, und der Index weiß nicht, was ein Bezeichner *bedeutet* — nur, wo er
steht.

### Und beim Suchen? Hier ist codemap langsamer als grep

Dieselbe Suche mit drei Werkzeugen, wieder an diesem Repo gemessen, Mittel aus zehn Läufen bei
warmem Dateisystem-Cache und sonst unbelasteter Maschine:

| | |
| --- | --- |
| `grep -rn "openRepoDb(" src/` | 4 ms |
| `ast-grep run -p 'openRepoDb($$$)' -l ts src/` | 22 ms |
| `codemap search openRepoDb` | 96 ms |

Das ist kein Messfehler und soll hier auch nicht schöngeredet werden. Bei 198 Dateien ist der
Index kein Geschwindigkeitsvorteil: Das reine Durchsuchen dauert bei dieser Größe ohnehin nur
Millisekunden. codemap ist rund fünfundzwanzigmal langsamer als `grep`. Von den 96 ms gehen rund 50 ms
für Prozessstart und Modulladen drauf, bevor überhaupt etwas gesucht wird — etwa 20 ms davon der
Start der Node-Laufzeit, der Rest das Einlesen des Programmcodes. Nur die restlichen rund 45 ms
kosten das Öffnen der Datenbank, die vier Abfragestufen, die genau diese Anfrage auslöst
(Abschnitt 7 nennt sieben mögliche; für `openRepoDb` bleiben vier), und die Bewertung.

Der Index rechnet sich über zwei andere Dinge:

1. **Die Sortierung.** `grep` liefert alle Fundstellen in Dateireihenfolge — bei einem häufigen
   Namen sind das hunderte Zeilen, die man selbst durchsehen muss. codemap liefert eine
   Rangfolge, in der Definition vor Aufruf und Quellcode vor Changelog steht.
2. **Die Größe.** Der Aufwand von `grep` wächst mit der Menge des Textes; der Aufwand einer
   Indexsuche wächst mit der Menge der *Treffer*. Bei kleinen Repos gewinnt `grep`, bei großen
   dreht sich das um.

### Wo der Punkt liegt, ab dem der Index gewinnt

An sechs Korpora wachsender Größe gemessen, Mittel aus je fünf Läufen, als Anfrage jeweils ein
Bezeichner mit einer bis neun Fundstellen:

| Korpus | Dateien | Größe | `git grep` | `codemap search` |
| --- | ---: | ---: | ---: | ---: |
| codemap | 245 | 1,4 MB | 3 ms | 82 ms |
| hermes | 3.427 | 66 MB | 20 ms | 84 ms |
| openclaw | 19.761 | 178 MB | 62 ms | 85 ms |
| openclaw + hermes | 23.074 | 241 MB | 77–85 ms | 89–90 ms |
| dasselbe + 2× hermes | 29.848 | 369 MB | 113–171 ms | 94–134 ms |
| dasselbe, verdoppelt | 46.148 | 481 MB | 161–173 ms | 108–114 ms |

**Der Umschlagpunkt liegt bei rund 25.000 bis 30.000 Dateien, also bei rund 300 MB.**

Die Spalten Dateien und Größe zählen dabei alle versionierten Dateien auf der Platte,
Binärdateien eingeschlossen, die beide Werkzeuge überspringen — im Korpus aus 23.074 Dateien
waren das 1.484. Deshalb stehen hier 245 Dateien und 1,4 MB, während oben von 198 indexierten
Dateien und 1,20 MB Text die Rede war. Die 82 ms und die 96 ms weiter oben sind zwei verschiedene
Anfragen an zwei verschiedenen Tagen; in dieser Größenordnung streuen die Werte.

Bemerkenswert ist weniger der Punkt selbst als der Verlauf: Über drei Größenordnungen hinweg
bleibt `codemap search` fast konstant — 82 ms beim kleinsten, 114 ms beim größten Korpus. Der
Index sucht nicht im Text, sondern schlägt Treffer nach; wie viel Text daneben liegt, ist ihm
gleichgültig. `grep` dagegen muss jedes Byte anfassen.

Das gilt allerdings nur für Anfragen nach seltenen Wörtern. Bei einem häufigen Wort kehrt sich
das Bild um, und zwar bei jeder Repo-Größe: `function` kostet beim Korpus aus 23.074 Dateien
`git grep` 118 ms und `codemap search` 729 ms. Dann muss codemap tausende Kandidaten bewerten,
während `git grep` nur Zeilen ausgibt.

Für den Alltag heißt das: Der Index lohnt sich bei diesem Repo nicht wegen der Laufzeit, sondern
allein wegen der Rangfolge — und die Trägheit von rund 90 ms bleibt, egal wie klein das Repo
ist. Es sind dieselben rund 50 ms Prozessstart und Modulladen wie oben, nur diesmal unabhängig
von der Repo-Größe.

Die Zahlen stammen von einer Maschine bei warmem Dateisystem-Cache. Die beiden größten Korpora
sind aus Kopien echter Repos gebaut: Ihr Textvolumen wächst, ihr Wortschatz nicht — ein echtes
Repo dieser Größe hätte mehr verschiedene Wörter und damit etwas höhere Indexkosten. Der
Umschlagpunkt ist deshalb eine Größenordnung, keine Schwelle.

## 10. Wozu die leeren Chunks gut sind

Das Beispiel aus Abschnitt 3 hatte zwei davon; im ganzen Repo sind es 550 von 1.884. Das
Textfeld ist leer, sie kosten zusammen 0 Bytes an Inhalt. Jeder von ihnen umfasst genau eine
Zeile: meist eine Leerzeile zwischen zwei Funktionen, in 80 Dateien die Stelle hinter dem letzten
Zeilenumbruch, die es als Textzeile gar nicht mehr gibt.

Was ihr Entfernen bringt, wurde gemessen: Die Datei bleibt zunächst gleich groß, weil SQLite
freigewordene Seiten behält; erst nach einem `vacuum` schrumpft sie — um 40 KB, also um
anderthalb Prozent. Nichts davon ist Inhalt, sondern der Überbau aus Tabellenzeilen und
Volltextindex.

Der Grund, sie zu behalten, ist ohnehin nicht der Platz, sondern eine Zusicherung: **Keine Zeile
fehlt, und die `ordinal`-Nummern laufen lückenlos.** Sobald man Lücken zuließe, müsste jede
Stelle, die aus Chunks wieder Dateiausschnitte zusammensetzt, mit Löchern umgehen können.

Überschneidungsfrei ist die Abdeckung dagegen nicht. Alles, was codemap nicht als Funktion
erkennt — eine unbekannte Sprache, aber auch die Strecke zwischen zwei erkannten Funktionen —,
zerlegt es in Blöcke von 80 Zeilen, und zwei benachbarte Blöcke überlappen sich dabei um 10
Zeilen, damit ein Treffer an der Schnittkante nicht in zwei Hälften zerfällt. In diesem Index
sind das 80 Blockpaare in 32 Dateien: 800 Zeilen stehen doppelt, 29 der 80 Paare allein in
`package-lock.json`, der Rest überwiegend in langen Testdateien.

## 11. Warum ast-grep ohne Index auskommt

`ast-grep` ist das zweite Werkzeug, das für Code-Suche empfohlen wird, und es braucht keinerlei
Vorbereitung. Der Grund ist nicht, dass es cleverer wäre — es beantwortet eine **andere Frage**.

| | codemap | ast-grep |
| --- | --- | --- |
| Frage | „Wo ist das Thema X relevant?“ | „Wo steht genau dieses Muster?“ |
| Antwort | eine Rangfolge | eine vollständige Fundliste, ungeordnet |
| Eingabe | ein paar Suchwörter | ein Codemuster mit Platzhaltern |
| Vorbereitung | Index nötig | keine |

### Was ast-grep tut

Es liest bei jedem Aufruf die Dateien frisch ein, baut daraus einen Syntaxbaum im Arbeitsspeicher
und vergleicht das Muster gegen die Knoten dieses Baums. Danach wird der Baum weggeworfen.

Das Muster ist selbst schon die vollständige Frage. `openRepoDb($$$)` heißt: „ein Aufruf von
`openRepoDb`, mit beliebigen Argumenten“. Die Antwort ist binär — es passt oder es passt nicht.
Es gibt nichts zu bewerten und keine Rangfolge.

### Warum ein Index nichts brächte

codemap kann Wörter vorberechnen, weil es endlich viele gibt: 8.807 in diesem Repo. Man kann sie
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
Text sieht: Die Zeichenkette `openRepoDb(` steht da nun einmal. `ast-grep` unterscheidet es, weil
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

### Wann der Index veraltet

Jede Ausgabe endet mit einem Hinweis, sobald der Index nicht mehr nachweislich zum
Arbeitsverzeichnis passt:

```
(!) index is stale for this query; run 'codemap index' to refresh
```

`codemap search` vergleicht dafür nur den aktuellen Git-Commit mit dem, auf dem der Index gebaut
wurde — das kostet nichts. `codemap context` und `codemap status --full` lesen dagegen jede Datei
und vergleichen Prüfsummen. Deshalb kann der Hinweis erscheinen, obwohl inhaltlich nichts fehlt:
„Stale“ heißt nicht „falsch“, sondern „nicht nachweislich aktuell“. Ein erneutes `codemap index`
dauert hier 0,08 s, wenn sich nichts geändert hat.

### In die Datenbank sehen

Die Datenbank ist eine gewöhnliche SQLite-Datei und lässt sich direkt öffnen. Den Pfad nennt das
Feld `dbPath` der Statusausgabe (Abschnitt 1 zu den möglichen Orten):

```bash
codemap status --json
```

```bash
sqlite3 "$(codemap status --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["dbPath"])')" "select path, start_line, end_line from chunks join files on files.id = chunks.file_id limit 10"
```

Der Wortschatz des Volltextindex ist nicht direkt lesbar. Sichtbar wird er über eine
Hilfstabelle, die aber in derselben Datei angelegt werden muss — also auf einer Kopie arbeiten,
nicht auf dem Index selbst. So sind die Zahlen aus Abschnitt 5 entstanden:

```bash
cp "$DB" /tmp/index-kopie.sqlite && sqlite3 /tmp/index-kopie.sqlite "create virtual table v using fts5vocab(chunks_fts, 'row'); select term, doc, cnt from v order by cnt desc limit 20"
```

## 13. Offene Punkte

- Die Zählwerte hängen am Indexstand von Commit cf4f501 und wandern mit jedem Lauf mit — dieses
  Dokument indexiert sich selbst mit. Wird es vor der Abnahme noch einmal geändert, sind Chunks,
  Symbole, Wortschatz und Datenbankgröße nachzuziehen.
- Die Punktwerte der Rangfolge sind in ihrer Herkunft belegt (Abschnitt 7), in ihrer Höhe aber
  weiterhin unbegründet: Keine der vorhandenen Messreihen ändert ihr Ergebnis, wenn man sie
  verstellt. Solange das so bleibt, sind sie geerbte Setzungen und keine Erkenntnisse.
- Abschnitt 8 trägt inzwischen zwei Themen: den Importgraphen und das Verhalten von
  `codemap context`. Ob die Leseliste einen eigenen Abschnitt bekommt — mit Umnummerierung der
  folgenden —, ist eine offene redaktionelle Entscheidung.
