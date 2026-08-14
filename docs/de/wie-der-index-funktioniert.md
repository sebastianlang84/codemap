# Wie der codemap-Index funktioniert

Erklärdokument, deutschsprachig, für Leser ohne Vorwissen. Alle Zahlen sind am Repo `codemap`
selbst gemessen, Stand 2026-08-14. Die technische Referenz bleibt
`docs/developer/architecture.md`; hier steht nur, was man verstehen muss, nicht jede Regel.

---

## 1. Das Grundprinzip

Einmal am Anfang liest codemap alle Dateien des Repos und legt das Ergebnis in einer
Datenbankdatei ab. Bei jeder Suche wird nur noch diese Datei gelesen — keine einzige Quelldatei
wird dafür geöffnet.

Der Zweck ist **nicht** in erster Linie Geschwindigkeit (dazu Abschnitt 8), sondern eine andere
Art von Antwort: eine nach Relevanz sortierte Rangfolge statt einer ungeordneten Liste aller
Textfundstellen. Diese Sortierung braucht Statistik über den gesamten Bestand, und die lässt sich
nicht bei jeder Anfrage neu ausrechnen.

Die Datenbank liegt außerhalb des Repos, standardmäßig unter
`~/.local/share/codemap/repos/<hash>.sqlite`; `codemap status --json` nennt den tatsächlichen
Pfad im Feld `dbPath`. Ohne Git geht dabei nichts: codemap ermittelt das Wurzelverzeichnis mit
`git rev-parse --show-toplevel` und bricht sonst ab. Für dieses Repo ist die Datei 3,2 MB groß —
ginge sie verloren, wäre sie in einer drittel Sekunde neu gebaut.

## 2. Was beim Indexieren passiert

`codemap index` sammelt die Dateien ein, verarbeitet jede geänderte, baut den Importgraphen neu
und schreibt alles in einer einzigen Transaktion. Ohne vorheriges `codemap index --approve`
bricht der Lauf ab; alles läuft lokal, und das Repo wird nicht verändert.

Übersprungen werden Verzeichnisse aus einer fest eingebauten Liste (`.git`, `node_modules`,
`dist`, `build` und rund zwanzig weitere), alles aus `.gitignore` und `.codemapignore`, Dateien
mit einer Endung, die codemap nicht als Text kennt — es sind 35 —, Bilder, Archive, minifizierte
Dateien, Symlinks, Binärdateien, Dateien, die nach Zugangsdaten aussehen, und alles über 1 MB.
Von diesen Regeln greifen hier nur drei, zusammen achtmal. Bemerkenswert dabei: `dist` steht in
der `.gitignore` dieses Repos gar nicht — ohne die eingebaute Liste läge der gebaute Code im
Index.

Stimmen Änderungsdatum und Größe mit dem letzten Lauf überein, wird eine Datei gar nicht erst
gelesen. Gelöschte Dateien fliegen aus dem Index, aber nur wenn der Durchlauf vollständig war —
sonst löschte ein vorübergehender Fehler den halben Index. Es läuft kein Hintergrunddienst.

## 3. Zwei getrennte Auswertungen pro Datei

Aus dem Text einer Datei entstehen **zwei voneinander unabhängige Ergebnisse**. Hier ist eine
naheliegende Vorstellung falsch: Die Symbole werden *nicht* aus den Chunks abgeleitet, sondern
direkt aus dem Dateitext.

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

**`chunkText()`** teilt die Datei in Chunks — zusammenhängende Zeilenbereiche. Wenn möglich, wird
so geschnitten, dass eine Funktion vollständig in einem Chunk landet; das gelingt bei TypeScript,
JavaScript und Python, Markdown wird an den Überschriften geschnitten. Bei allen übrigen Sprachen
weiß codemap nicht, wo eine Funktion anfängt, und zerschneidet die Datei stur alle 80 Zeilen,
wobei sich benachbarte Blöcke um 10 Zeilen überlappen.

```
src/core/indexer.ts:
Chunk 0   Zeile  1– 9   kind: text      die Import-Zeilen
Chunk 1   Zeile 10–32   kind: function  indexRepo, vollständig
Chunk 2   Zeile 33–33   kind: text      leer — die Leerzeile dazwischen
Chunk 3   Zeile 34–57   kind: function  status, vollständig
Chunk 4   Zeile 58–58   kind: text      leer — hinter dem letzten Zeilenumbruch
```

**`extractSymbols()`** sucht mit 32 regulären Ausdrücken — Suchmustern, die auf Text passen, ohne
die Sprache zu verstehen — nach Stellen, an denen etwas definiert wird. Das ist bewusst grob:
Das Verfahren ist ungefähr richtig, nicht garantiert richtig. Ein Beispiel dafür steckt im Index
dieses Repos: Der Name „local development:“ gilt als Überschrift, obwohl er in `README.md` nur
eine Kommentarzeile in einem Codeblock ist.

## 4. Die Tabellen

Von 16 Tabellen muss man vier kennen. Die ersten drei haben je sieben Spalten:

```
files     id  path  language  size  hash  mtime_ms  indexed_at        198 Zeilen
chunks    id  file_id  ordinal  start_line  end_line  kind  text    1.856 Zeilen
symbols   id  file_id  name  kind  start_line  end_line  signature 1.382 Zeilen
```

Der Dateipfad steht genau einmal, in `files`; alles andere verweist mit einer Nummer darauf.
`chunks` enthält den Quelltext ein zweites Mal — Absicht, damit Suchtreffer sich anzeigen lassen,
ohne eine Datei zu öffnen. `id` ist immer die Nummer *in dieser* Tabelle: Die 46 bezeichnet in
jeder Tabelle etwas anderes.

Die vierte ist `chunks_fts`, der Volltextindex — ein Sonderfall mit vier Spalten, von denen keine
beim Lesen etwas zurückgibt. Dazu kommt `symbols_fts` nach demselben Muster für die Namen, und
`graph_nodes`/`graph_edges` für den Importgraphen (Abschnitt 7).

## 5. Der Volltextindex und die Suche

`chunks_fts` speichert keinen Inhalt, sondern nur, **welches Wort in welchem Chunk vorkommt**.
Nutzbar ist allein die Datensatznummer `rowid`, und die zeigt auf `chunks`.

Der Text wird an allen Zeichen zerlegt, die keine Buchstaben oder Ziffern sind; Groß- und
Kleinschreibung spielt keine Rolle. `db.exec` wird zu `db` und `exec`, `read_first` zu `read` und
`first` — aber `scanRepoStream` bleibt **ein** Wort, denn Großbuchstaben trennen nicht. Daraus
folgt die praktische Fehlerquelle: Ein Bruchstück mitten aus einem Namen findet nichts.
`codemap search RepoStream` liefert „No results“, `scanRepo` dagegen den Treffer.

Beim Suchen wird dagegen zerlegt: `openRepoDb` sucht nach vier Wörtern — `openrepodb`, `open`,
`repo`, `db`. Deshalb findet die Suche auch dann etwas, wenn man den Namen nur ungefähr trifft,
und deshalb tauchen weit unten Treffer auf, die nur `db` enthalten.

Wort und Symbol sind nicht dasselbe. `indexRepo` kommt als Wort in 84 Chunks vor — Aufrufe,
Kommentare, Tests, Changelog —, als Symbol genau einmal: `src/core/indexer.ts` Zeile 10. Wörter
fallen automatisch an, ohne Auswahl und ohne Bedeutung: 8.210 verschiedene in diesem Repo, in
160.223 Vorkommen, wofür 644 KiB draufgehen. Symbole sind gezielt gesucht.

Eine Suche schlägt in beiden Indizes nach, im Textindex (`chunks_fts`) und im Namensindex
(`symbols_fts`). Keine Datei wird geöffnet. Weil beide auf Zeilen zeigen und nicht auf Dateien,
ist die Antwort ein Ort in der Datei: Bei einer 700-Zeilen-Datei ist „steht irgendwo da drin“
wertlos, „Zeile 60“ ist brauchbar.

## 6. Wie die Rangfolge zustande kommt

Hier steckt die eigentliche Arbeit, denn die Rangfolge ist der einzige Grund, überhaupt einen
Index zu bauen.

Eine naheliegende Annahme wäre, dass SQLites eingebaute Relevanzformel bm25 die Sortierung macht.
Sie tut es nicht: Ihr Wert wird auf 5 Punkte gedeckelt, und die Deckelung greift bei praktisch
jedem Treffer. Von bm25 bleibt eine Ja/Nein-Auskunft — kommt das Wort vor, gibt es rund 15
Punkte, sonst 0.

Die Rangfolge entsteht stattdessen aus einer Summe von rund einem Dutzend Beiträgen, die codemap
selbst berechnet. `codemap search openRepoDb` findet als besten Treffer die Definition in
`src/core/db.ts`, mit 109 Punkten:

| Beitrag | Punkte | warum |
| --- | ---: | --- |
| Herkunft | 22 | Treffer im Namensindex, bei einer wörtlichen Abfrage |
| Volltexttreffer | 15 | Grundwert 10 + gedeckelte 5 |
| Symbolwertung | 51 | Symbolname ist genau die Anfrage (28) + ein Suchwort ist genau der Symbolname (20) + die Anfrage steht in der Signatur (3) |
| Dateiname | 9 | `db` ist der Dateistamm (8) + ein Viertel der Suchwörter im Namen (1) |
| Anfrage steht wörtlich im Text | 4 | |
| Quellcode-Bonus | 6 | Code-Endung (2) + liegt unter `src/` (4) |
| Wortabdeckung, Pfadwertung | 2 | |
| **Summe** | **109** | |

Dahinter folgen sechs Treffer gleichauf bei 51,5. Der Abstand von 57,5 Punkten stammt fast ganz
aus der Symbolwertung und dem Dateinamen: In `db.ts` steht `openRepoDb` als *Name* einer
Funktion, in den anderen nur in einer Typangabe.

Nach unten wirken Abzüge, und die addieren sich: Lockfiles verlieren 60 Punkte, generierter Code
60, Build-Ausgaben 48, große JSON-Dateien 36, Agentenanweisungen 18, archivierte Dokumentation
14, Testdateien 8 oder 3, Dokumentation 6. Das `package-lock.json` dieses Repos zählt doppelt und
verliert 96 — sonst gewinnt es bei jeder Suche nach einem Paketnamen, denn es enthält den Namen
hunderte Male. Umgekehrt gibt es einen Rettungsplatz für Quellcode: Bei einer Anfrage in normaler
Sprache trifft Prosa besser als Code, weshalb codemap zusätzlich bis zu sechs Code-Chunks je
Abfragestufe nachholt, ohne dafür etwas zu entfernen.

Am Ende fliegt raus, was 0 oder weniger Punkte hat; pro Datei bleibt der bestbewertete Kandidat,
und bei Gleichstand entscheidet der Pfad alphabetisch — kein Qualitäts-, sondern ein
Reproduzierbarkeitskriterium.

**Woher die Punktwerte stammen.** Sie sind gesetzt, nicht ausgerechnet. Die 28 für eine exakte
Symbolübereinstimmung standen im Mai 2026 zuerst auf 8 und wurden zusammen mit drei weiteren
Werten angehoben; warum auf 28 und nicht auf 20 oder 40, hält kein Commit, kein ADR und kein
Eval-Dokument fest. Nachgemessen: Setzt man den Wert auf irgendetwas zwischen 0 und 60, ändert
keine vorhandene Messreihe ihr Ergebnis. Der Beitrag trifft alle Kandidaten mit demselben
Symbolnamen gleich und verschiebt damit das Feld, nicht die Reihenfolge darin.

Vollständig stehen die Regeln nur im Code: `src/core/ranking.ts`, `src/core/search-pipeline.ts`
und `src/core/query-plan.ts`.

## 7. Der Importgraph und `codemap context`

`graph_nodes` und `graph_edges` beantworten, was der Volltextindex nicht kann: **welche Datei
benutzt welche andere?** 198 Knoten, 252 Kanten, gefunden mit sechs regulären Ausdrücken für
TypeScript, JavaScript, Python und C/C++ — nicht durch Auflösung des Modulsystems. Erfasst werden
nur repo-interne Verweise; `import { readFile } from "node:fs"` erzeugt keine Kante. Deshalb
haben 107 der 198 Dateien keine einzige ausgehende Kante.

`codemap context <pfad>` beantwortet damit die Frage „was muss ich außer dieser Datei noch
lesen?“ und gibt voreingestellt acht Einträge aus:

```
src/core/graph-store.ts:1-14   [text] (target)
src/core/db.ts:1-5             [text] (import)
src/core/indexed-source.ts:1-19 [text] (import)
tests/index-store-deletion-guard.test.ts:1-12 [text] (sibling_test)
src/core/index-store.ts:1-37   [text] (reverse_import)
tests/fixtures/context-quality/README.md:1-4 [markdown] (related_doc)
```

Aus dem Graphen stammen nur `import` und `reverse_import`. Alles andere — Tests, verwandte
Dokumente, Nachbarn im selben Ordner — kommt aus Namens- und Verzeichnisregeln, ohne jede Kante.
Die Rückrichtung ist die eigentlich wertvolle: „wer benutzt das?“ ist mit Textsuche mühsam, mit
einer Tabelle trivial. Sie ist zugleich bewusst unvollständig, denn je Richtung werden höchstens
16 Kanten gelesen und daraus höchstens 8 Dateien behalten — ausgewählt alphabetisch, nicht nach
Wichtigkeit. Bei einer viel importierten Datei ist die Antwort ein Einstieg, keine Liste.

Was fehlt: Der Graph kennt Dateien, keine Funktionen. „Wer ruft `openRepoDb` auf?“ beantwortet er
nicht, nur „wer importiert `db.ts`?“. Ein Aufrufgraph bräuchte einen echten Parser — genau das,
worauf codemap verzichtet.

## 8. Geschwindigkeit, ehrlich gerechnet

Am Repo selbst gemessen, Mittel aus zehn Läufen:

| | |
| --- | --- |
| Vollständiges Indexieren, kalt | 0,32 s |
| Erneutes Indexieren ohne Änderungen | 0,08 s |
| Umfang | 198 Dateien, 1,17 MB Text, 8 übersprungen |
| Ergebnis | 1.856 Chunks, 1.382 Symbole, 3,2 MB Datenbank |

Der Grund für diese Zahlen ist, was **nicht** passiert: kein Syntaxbaum, kein Parser, keine
Embeddings, kein Sprachmodell, kein Netzwerk, keine Typauflösung. Diese Verzichtsliste ist
zugleich die Grenze des Verfahrens — der Index weiß nicht, was ein Bezeichner *bedeutet*, nur wo
er steht.

Beim Suchen ist codemap dagegen langsamer als `grep`, und das soll hier nicht schöngeredet
werden:

| | |
| --- | --- |
| `grep -rn "openRepoDb(" src/` | 4 ms |
| `ast-grep run -p 'openRepoDb($$$)' -l ts src/` | 22 ms |
| `codemap search openRepoDb` | 96 ms |

Von den 96 ms gehen rund 50 ms für Prozessstart und Modulladen drauf, bevor überhaupt etwas
gesucht wird; nur der Rest kostet Datenbank, Abfragen und Bewertung. Bei 198 Dateien ist der
Index also kein Geschwindigkeitsvorteil — das reine Durchsuchen dauert bei dieser Größe ohnehin
nur Millisekunden.

Er rechnet sich über zwei andere Dinge. Erstens die Sortierung: `grep` liefert alle Fundstellen
in Dateireihenfolge, codemap eine Rangfolge, in der Definition vor Aufruf steht. Zweitens die
Größe: Der Aufwand von `grep` wächst mit der Textmenge, der einer Indexsuche mit der Zahl der
*Treffer*. An sechs Korpora wachsender Größe gemessen bleibt `codemap search` über drei
Größenordnungen fast konstant — 82 ms beim kleinsten, 114 ms beim größten —, während `git grep`
von 3 ms auf über 160 ms steigt. **Der Umschlagpunkt liegt bei rund 25.000 bis 30.000 Dateien,
also bei rund 300 MB**; er ist eine Größenordnung, keine Schwelle. Details und Vorbehalte in
`docs/developer/search-quality.md`.

Das gilt nur für Anfragen nach seltenen Wörtern. Bei einem häufigen Wort kehrt sich das Bild um
und bleibt umgekehrt: `function` kostet `git grep` 118 ms und `codemap search` 729 ms.

## 9. Zwei Randfälle, die erklärungsbedürftig sind

**Leere Chunks.** 550 der Chunks haben gar keinen Text. Sie zu behalten kostet nichts und sichert
zu, dass keine Zeile fehlt und die `ordinal`-Nummern lückenlos laufen — sonst müsste jede Stelle,
die aus Chunks wieder Dateiausschnitte zusammensetzt, mit Löchern umgehen können.
Überschneidungsfrei ist die Abdeckung dagegen **nicht**: Wo alle 80 Zeilen geschnitten wird,
überlappen benachbarte Blöcke um 10 Zeilen. In diesem Index stehen dadurch 800 Zeilen aus 32
Dateien doppelt.

**Stale.** Jede Ausgabe endet mit einem Hinweis, sobald der Index nicht mehr nachweislich zum
Arbeitsverzeichnis passt. `codemap search` vergleicht dafür nur den Git-Commit, `codemap context`
und `codemap status --full` lesen jede Datei und vergleichen Prüfsummen. „Stale“ heißt deshalb
nicht „falsch“, sondern „nicht nachweislich aktuell“ — ein erneutes `codemap index` dauert hier
0,08 s, wenn sich nichts geändert hat.

## 10. Warum ast-grep ohne Index auskommt

`ast-grep` ist das zweite empfohlene Werkzeug für Code-Suche und braucht keine Vorbereitung —
nicht weil es cleverer wäre, sondern weil es eine andere Frage beantwortet. codemap beantwortet
„wo ist das Thema X relevant?“ mit einer Rangfolge; `ast-grep` beantwortet „wo steht genau dieses
Muster?“ mit einer vollständigen, ungeordneten Fundliste.

Ein Index brächte dort nichts. Wörter kann man vorberechnen, weil es endlich viele gibt — 8.210
in diesem Repo. Muster nicht: `openRepoDb($$$)`, `$X.prepare($$$)`, `if ($C) { return $$$ }` —
jede Kombination von Code und Platzhaltern ist eines. Also wird bei jedem Aufruf neu geparst.

Was das praktisch bedeutet, zeigt die Suche nach allen **Aufrufen** von `openRepoDb`:
`ast-grep` findet 5, `grep` findet 6. Der sechste ist `src/core/db.ts:6` — die Definition, kein
Aufruf. `grep` kann das nicht unterscheiden, weil es nur Text sieht.

Daraus die Arbeitsteilung: **codemap**, wenn man ein Thema oder einen Namen sucht und nicht weiß,
wo man anfangen soll. **ast-grep**, wenn man die Syntax der gesuchten Stelle genau kennt oder
über viele Dateien umschreiben will. **grep** für alles, was kein Code ist.

## 11. Selbst nachsehen

Die Datenbank ist eine gewöhnliche SQLite-Datei:

```bash
sqlite3 "$(codemap status --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["dbPath"])')" \
  "select path, start_line, end_line from chunks join files on files.id = chunks.file_id limit 10"
```

Der Wortschatz des Volltextindex ist nur über eine Hilfstabelle sichtbar, die in derselben Datei
angelegt werden muss — also auf einer Kopie arbeiten, nicht auf dem Index selbst:

```bash
cp "$DB" /tmp/kopie.sqlite && sqlite3 /tmp/kopie.sqlite \
  "create virtual table v using fts5vocab(chunks_fts, 'row'); select term, doc, cnt from v order by cnt desc limit 20"
```

## 12. Offen

Die Höhe der Ranking-Punktwerte ist unbegründet (Abschnitt 6). Solange keine Messreihe auf sie
reagiert, sind es geerbte Setzungen. Ein Beleg bräuchte zuerst einen Fall, in dem ein exakter
Symboltreffer knapp gegen etwas anderes verliert.
