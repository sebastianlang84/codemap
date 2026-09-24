# Skill-Vergleich auf einem großen Repo

Vorab eingefroren am 2026-09-25, vor jedem Modellaufruf. Anlass: Im
[Dreiarmvergleich vom 8. September](todo-agent-development-result.md) setzten Agenten
`status`, `search` und `context` vor ihre gewohnte Navigation, statt sie zu ersetzen, und bündelten
weniger. Auf kleinen Repos braucht normale Suche nur etwa drei Navigationsaufrufe pro Aufgabe.
Ein Vorsprung für CodeMap ist deshalb nur auf einem großen Repo möglich.

## Aufbau

- **Repo:** Django, 7.091 Dateien, davon 2.932 Python-Dateien. Index in etwa 6 s.
- **Aufgaben:** zwölf Fixcommits seit Juni 2025, [Manifest](../../scripts/eval-agent-impact-large-repo-skill.manifest.json).
  Jede Aufgabe ändert eine Quelldatei unter `django/` mit höchstens 40 geänderten Zeilen sowie eine oder zwei
  Testdateien. Jede ist lokal geprüft: rot am Basis-Commit mit den Fixtests, grün am Fix-Commit.
  Die Prompts beschreiben das Fehlverhalten mit öffentlichen Namen und nennen keine Dateien.
- **Arme:** K ohne CodeMap. S0 erhält den heutigen Skill-Text,
  [`current.md`](../../scripts/fixtures/skill-arms/current.md). S1 erhält den Kandidaten,
  [`candidate.md`](../../scripts/fixtures/skill-arms/candidate.md). Der Kandidat unterscheidet sich nur
  im Workflow: kein `status`-Aufruf vorab, erste Lesebefehle im selben Shell-Aufruf, gelieferte Zeilen
  nicht erneut lesen. Beide Skill-Arme dürfen `context` nutzen. Die Nutzung ist optional und wird
  nur berichtet.
- **Agent:** Codex CLI mit `gpt-6-luna`, Effort `medium`, 15 Minuten je Lauf, rotierende Reihenfolge,
  je ein Lauf pro Aufgabe und Arm, also 36 reguläre Läufe und höchstens zwei Infrastruktur-Ersatzläufe.
- **Produkt:** CodeMap am Commit des Manifests, einschließlich Ortsfixes und Klassenaufteilung.

## Gates für S1 gegen K

Dieselben Schwellen wie am 8. September:

1. Keine gepaarte Qualitätsverschlechterung, alle zwölf Paare gültig.
2. Gesamtzeit aus Agent, Index und Prüfung höchstens 85 % von K.
3. Tokens einschließlich Cache höchstens 110 % von K.
4. Mindestens acht der zwölf Aufgaben schneller als K.

## Entscheidung

Gemessen wird aus den Traces je Arm: Tokens einschließlich Cache, Befehlsaufrufe und die Zahl der
Aufgaben mit mindestens einem CodeMap-Aufruf (`search` oder `context`). Das Harness-Gate prüft die
Nutzung über `minTreatmentAdoptionRate` 0,66, also mindestens acht von zwölf Aufgaben.

- **S1 besteht alle Gates und nutzt CodeMap in mindestens acht Aufgaben:** CodeMap nutzt Agenten auf
  großen Repos. Der Kandidat wird zum Skill. Weiterer Ausbau ist gerechtfertigt, zuerst die Übertragung
  des Kandidaten A aus dem Span-Replay.
- **Sonst, wenn S1 keine Aufgabe verliert, die S0 löst, und insgesamt weniger Tokens und weniger
  Befehlsaufrufe braucht als S0:** Der Kandidat wird zum Skill, weil er den bestehenden optionalen Weg
  billiger macht. CodeMap bleibt optional und geht in den Wartungsmodus: Fehler beheben, keine neuen
  Funktionen.
- **Sonst:** Der Skill bleibt unverändert, CodeMap geht in den Wartungsmodus.

Das Harness-Gate (`--quality-gate`) entscheidet nur die erste Regel. Scheitert es, auch allein an der
Nutzungsschwelle, werden die zweite und dritte Regel aus den Traces ausgewertet. S0 gegen K wird
beschreibend berichtet.

## Grenzen

Ein Lauf pro Aufgabe und Arm, ein Modell, ein Repo. Die Aufgaben sind öffentliche Django-Commits, das
Modell kann sie aus dem Training kennen. Das betrifft alle Arme gleich. Andere Hostjobs können
Zeiten verzerren; die Last wird mitgeschrieben.
