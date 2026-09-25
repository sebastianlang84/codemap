# Aufgaben ohne Code-Namen auf Django: Ergebnis

2026-09-25. [Protokoll](nameless-task-protocol.md), [Messdaten](nameless-task-result.json).
**Entscheidung nach Regel 3: Auch ohne Code-Namen ist kein Nutzen belegt. Aufrufer- und Testsuche werden
nicht gebaut, CodeMap bleibt im Wartungsmodus.**

Mit Vorgabe fand CodeMap die Zieldatei meist als erstes Werkzeug. Die Agenten wurden dadurch aber
langsamer und teurer, nicht besser: Ohne CodeMap lösten sie jede Aufgabe mit rund fünf Befehlen.

| | K ohne CodeMap | S0 heutiger Skill | F CodeMap zuerst |
|---|---:|---:|---:|
| Gelöste Aufgaben, alle zwölf | 12/12 | 11/12 | 11/12 |
| Befehlsaufrufe | 65 | 61 | 108 |
| Aufgaben mit CodeMap-Aufruf des Agenten | — | 0/12 | 12/12 |
| Tokens einschließlich Cache | 1.872.394 | 1.729.347 | 2.398.888 |
| Agentenzeit | 524 s | 547 s | 681 s |

Entscheidungszahlen auf den elf Aufgaben ohne 04, aus
[`analyze-first-surface.py`](../../scripts/analyze-first-surface.py):

| | S0 gegen K | F gegen K |
|---|---:|---:|
| Gelöst | 11/11 | 11/11 |
| Verluste / Gewinne | 0 / 0 | 0 / 0 |
| Schneller als K | 4 | 0 |
| Gesamtzeit (Verhältnis zu K) | 1,15 | 1,37 |
| Tokens (Verhältnis zu K) | 0,93 | 1,27 |
| Wirksame Nutzung | 0 | 9 |

## Regeln

1. **Regel 1:** gescheitert. Das Harness-Gate für F meldet Tokens 128 % statt höchstens 110 %,
   Gesamtzeit 137 % statt höchstens 85 %, keine statt mindestens acht schnellere Aufgaben und einen
   gepaarten Verlust (Aufgabe 04). Nutzung und wirksame Nutzung reichten: 12/12 und 9/11.
2. **Regel 2:** gescheitert. F löst keine Aufgabe, die K nicht löst; K löst alle elf.
3. **Also:** Wartungsmodus bleibt.

## Beobachtungen

- **Kein Spielraum:** K löste auch ohne Namen alle zwölf Aufgaben, mit 5,4 Befehlen pro Aufgabe. Im
  Skill-Vergleich mit Namen waren es 4,8 Befehle und zehn gelöste Aufgaben; die zwei Fehlschläge dort
  lagen am ungenannten Fehlertext. Die Beschreibungen enthielten genug Fachwörter für `rg`. Das ist ein
  anderer Lauf und nur ein Hinweis.
- **Überwiegend Zusatz:** F rief in jeder Aufgabe `status`, meist zweimal `search` und einmal `context`
  auf: 51 CodeMap-Aufrufe neben 57 anderen Befehlen, gegenüber 65 Befehlen in K. Wie am 8. September
  kamen die CodeMap-Aufrufe überwiegend zur gewohnten Navigation hinzu. Nur vereinzelt ersetzten sie
  sie, etwa in Aufgabe 07, wo F ohne `rg` auskam.
- **Heutiger Skill:** S0 rief CodeMap in keiner Aufgabe auf. Seine Tokens lagen unter K, die Zeit
  darüber; ohne CodeMap-Aufruf sind diese Unterschiede nicht CodeMap zuzuordnen.
- **Restnamen in den Prompts:** Aufgabe 10 nennt den Argumentnamen `bcc`. Er steht im zweiten Satz des
  Fehlertexts, den der versteckte Test vollständig prüft. Wie bei 04 verletzt das die Promptregel, wurde
  vor dem Freeze aber nicht erkannt. Aufgabe 08 nennt den Python-Builtin `iter`. Ohne 04, 08 und 10 bleibt das Bild gleich: neun von neun in beiden
  Armen gelöst, F nie schneller, Gesamtzeit 130 % und Tokens 115 % von K.
- **Aufgabe 04:** Sie scheiterte in S0 und F und gelang in K. Sie zählt für keine Entscheidungszahl,
  weil ihr Fehlertext den Attributnamen verrät; im Harness-Gate ist sie der eine gepaarte Verlust.

## Grenzen

Ein Lauf pro Aufgabe und Arm, ein Repo, öffentlich bekannte Commits, dieselben Aufgaben wie im
Skill-Vergleich. Angefordert war `gpt-6-luna` mit Effort `medium`; welches Modell antwortete, meldet die
CLI nicht. Die Prompts enthielten Fachwörter, wie echte Fehlerberichte. Aufgaben ohne solche Wörter und
Architekturfragen ohne prüfbares Orakel sind nicht gemessen. Wirksame Nutzung heißt nur, dass CodeMap
die Datei zuerst nannte.
