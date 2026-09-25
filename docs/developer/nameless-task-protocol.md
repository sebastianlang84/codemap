# Aufgaben ohne Code-Namen auf Django

Vorab eingefroren am 2026-09-25, vor jedem Modellaufruf. Anlass: Im
[Skill-Vergleich](large-repo-skill-result.md) nannten alle Prompts die betroffene API, und die Agenten
fanden die Stelle mit `rg` in etwa fünf Befehlen. Offen blieb, ob CodeMap hilft, wenn eine Aufgabe nur
das beobachtete Verhalten beschreibt.

## Frage

Hat CodeMap auf Aufgaben ohne Code-Namen einen messbaren Nutzen, wenn Agenten es tatsächlich nutzen?
Nur dann lohnen weitere Funktionen wie eine Aufrufer- oder Testsuche.

## Aufbau

- **Aufgaben:** dieselben zwölf geprüften Django-Aufgaben wie im Skill-Vergleich, mit denselben Commits,
  Orakeln und versteckten Tests ([Manifest](../../scripts/eval-agent-impact-large-repo-nameless.manifest.json)).
- **Prompts:** neu formuliert. Sie beschreiben das beobachtbare Verhalten und nennen keine Code-Namen: keine
  Funktionen, Klassen, Methoden, Attribute, Einstellungen, Module oder Dateipfade in Code-Schreibweise.
  Fachwörter bleiben erlaubt, etwa Python-Ausnahmen, HTTP-Headernamen, Algorithmen wie PBKDF2 und MD5 und
  gewöhnliche englische Wörter. Einige davon kommen als Bezeichner in den Zieldateien vor: `request`,
  `message`, `headers`, `body`, `delete`, `disabled`, `initial`. Vier sind zugleich Dateinamen:
  `widgets`, `response`, `request`, `message`. Das ist bekannt und bleibt so, weil echte Fehlerberichte
  diese Wörter enthalten.
- **Fehlertexte:** Die versteckten Tests von Aufgabe 04 und 10 prüfen den genauen Fehlertext. Im
  Skill-Vergleich nannte kein Prompt ihn, und beide Aufgaben scheiterten in allen Armen trotz richtiger
  Datei. Beide Prompts nennen den Text jetzt. Der Text von Aufgabe 04 enthält den Attributnamen
  `reason_phrase`; diese Aufgabe verrät ihren Ort also teilweise. Sie läuft mit, zählt aber für keine
  Entscheidungszahl außer dem Harness-Gate. Beide Prompts verlangen nur, was der
  versteckte Test prüft: Aufgabe 04 nur den Konstruktor, Aufgabe 10 nur die Schreibweise `Bcc`.
- **Testbefehl:** Der fokussierte Testbefehl verriet bisher das Testmodul. Die Agenten sehen stattdessen
  nur einen allgemeinen Hinweis auf Djangos Testrunner (`testHint`). Der Harness nutzt den fokussierten
  Befehl weiter für die Sandbox-Prüfung.
- **Arme:** K ohne CodeMap. S0 erhält den heutigen Skill-Text,
  [`current.md`](../../scripts/fixtures/skill-arms/current.md). F erhält denselben Text mit einer Vorgabe,
  die Navigation mit CodeMap zu beginnen, und der Erlaubnis, mit Fachwörtern statt Code-Namen zu suchen,
  [`codemap-first.md`](../../scripts/fixtures/skill-arms/codemap-first.md).
  F misst den Wert bei Nutzung, S0 die Nutzung im Alltag.
- **Agent:** Codex CLI mit `gpt-6-luna`, Effort `medium`, 15 Minuten je Lauf, rotierende Reihenfolge,
  ein Lauf pro Aufgabe und Arm, also 36 reguläre Läufe und höchstens zwei Infrastruktur-Ersatzläufe.
- **Produkt:** CodeMap am Commit `5b48617`, unverändert seit dem Skill-Vergleich.

## Gates für F gegen K

Dieselben Schwellen wie im Skill-Vergleich:

1. Keine gepaarte Qualitätsverschlechterung, alle zwölf Paare gültig.
2. Gesamtzeit aus Agent, Index und Prüfung höchstens 85 % von K.
3. Tokens einschließlich Cache höchstens 110 % von K.
4. Mindestens acht der zwölf Aufgaben schneller als K.
5. CodeMap-Nutzung (`search` oder `context`) in mindestens acht Aufgaben, `minTreatmentAdoptionRate` 0,66.

## Wirksame Nutzung

Ein Aufruf zählt für das Harness-Gate schon als Nutzung, auch wenn er nichts findet. Für die
Entscheidung zählt deshalb zusätzlich die wirksame Nutzung, ausgewertet mit
[`analyze-first-surface.py`](../../scripts/analyze-first-surface.py). Das Skript nimmt die Läufe aus
den Messdaten und sucht sie in allen Trace-Verzeichnissen des Laufs, gebunden an den Manifest-Hash. Es
geht Agentenmeldungen, Befehle und Dateiänderungen in Reihenfolge durch. Ist das erste Element, das den
erwarteten Quellpfad nennt, ein Befehl nur aus `codemap search` oder `codemap context`, höchstens
weitergeleitet an `head`, `tail` oder `jq`, und nennt der Befehl selbst den Pfad nicht, hat CodeMap die
Zieldatei als Erstes gefunden. Eine solche Aufgabe zählt als wirksam genutzt; Aufgabe 04 zählt nie.
Gemessen wird damit, dass CodeMap die Datei zuerst nannte, nicht, dass der Agent seine Lösung darauf
stützte.

## Entscheidung

Alle Entscheidungszahlen außer dem Harness-Gate rechnet das Skript auf den elf Aufgaben ohne 04:
gelöste Aufgaben, Verluste und Gewinne gegenüber K, schnellere Paare, Zeit- und Tokenverhältnis sowie
wirksame Nutzung. Zeit ist wie im Harness Agent plus Index plus Prüfung, Tokens schließen den Cache ein.

- **Regel 1, Nutzen bei Nutzung:** F besteht das Harness-Gate mit allen fünf Gates. Auf den elf Aufgaben
  gilt zusätzlich: kein Verlust gegenüber K, mindestens sechs gelöst, mindestens acht schneller,
  Gesamtzeit höchstens 85 % und Tokens höchstens 110 % von K, wirksame Nutzung in mindestens acht. CodeMap hilft bei Aufgaben ohne Namen, und
  der Engpass ist die Nutzung. Nächster Schritt: ein Skill-Auslöser für solche Aufgaben, danach Aufrufer-
  und Testsuche, beides mit eigenem Protokoll.
- **Regel 2, Nutzen in der Qualität:** Sonst, wenn F auf den elf Aufgaben CodeMap in mindestens acht wirksam nutzt, keine
  Aufgabe verliert, die K löst, und mindestens zwei Aufgaben löst, die K nicht löst: gleicher nächster Schritt,
  begründet mit Qualität statt Zeit.
- **Regel 3:** Sonst ist auch ohne Namen kein Nutzen belegt. Aufrufer- und Testsuche werden auf dieser
  Grundlage nicht gebaut, CodeMap bleibt im Wartungsmodus.

Scheitert das Harness-Gate (`--quality-gate`), gilt Regel 1 als nicht erfüllt; Regel 2 wird dann aus
den Skriptzahlen ausgewertet.

Nur beschreibend, ohne Gate:

- S0: Nutzung, wirksame Nutzung, gelöste Aufgaben, Tokens und Befehle gegenüber K und F.
- Spielraum: Befehle pro Aufgabe und gelöste Aufgaben von K hier gegenüber K im Skill-Vergleich. Das ist
  ein anderer Lauf; der Unterschied zeigt nur, ob namenlose Aufgaben überhaupt schwerer sind.

## Grenzen

Ein Lauf pro Aufgabe und Arm, ein Modell, ein Repo. Die Aufgaben sind öffentliche Django-Commits, die
das Modell aus dem Training kennen kann, und sie wurden schon im Skill-Vergleich genutzt. Die Prompts
formulierte dieselbe Sitzung, die die Hypothese aufgestellt hat. Architekturfragen ohne prüfbares Orakel
sind nicht abgedeckt. Andere Hostjobs können Zeiten verzerren; die Last wird mitgeschrieben.
