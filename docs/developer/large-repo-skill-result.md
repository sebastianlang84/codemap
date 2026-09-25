# Skill-Vergleich auf Django: Ergebnis

2026-09-25. [Protokoll](large-repo-skill-protocol.md), [Messdaten](large-repo-skill-result.json).
**Entscheidung nach Regel 3: Der Skill bleibt unverändert, CodeMap geht in den Wartungsmodus.**

Die Agenten riefen CodeMap fast nie auf, obwohl das Repo groß war und der Skill verfügbar.

| | K ohne CodeMap | S0 heutiger Skill | S1 Kandidat |
|---|---:|---:|---:|
| Gelöste Aufgaben | 10/12 | 9/12 | 10/12 |
| Aufgaben mit CodeMap-Aufruf | — | 2/12 | 0/12 |
| CodeMap-Aufrufe | — | 2 `status`, 2 `search`, 0 `context` | keine |
| Tokens einschließlich Cache | 1.530.613 | 1.360.313 | 1.365.020 |
| Befehlsaufrufe | 58 | 58 | 54 |
| Agentenzeit | 454 s | 417 s | 420 s |
| Gesamtzeit mit Index und Prüfung (Verhältnis zu K) | — | 1,058 | 1,060 |

Gezählt sind nur Aufrufe der Agenten. Die Indexierung durch den Harness ist in der Gesamtzeit enthalten.

## Regeln

1. **Gates für S1 gegen K:** gescheitert. Nutzung 0/12 statt mindestens 8/12, Gesamtzeit 106 % statt
   höchstens 85 %, nur 4 statt mindestens 8 schnellere Aufgaben. Keine Qualitätsverschlechterung,
   Tokens 89 % von K.
2. **S1 gegen S0:** S1 löst jede Aufgabe, die S0 löst, und braucht 54 statt 58 Befehlsaufrufe, aber
   4.707 Tokens mehr. Die Regel verlangt weniger Tokens und weniger Befehle, sie greift also nicht.
3. **Also:** Skill unverändert, Wartungsmodus.

## Beobachtungen

- **Kaum genutzt:** Im Mittel brauchte K 4,8 Befehle pro Aufgabe. Die Prompts benennen öffentliche
  APIs wie `touch()` oder `JSONField.has_changed()`. Der Skill greift laut Beschreibung erst, wenn eine
  erste `rg`-Suche nichts Brauchbares liefert. Die Agenten entschieden sich fast immer gegen CodeMap. Ob
  sie die Stelle jeweils mit der ersten Suche fanden, erfassen die Messdaten nicht.
- **Nicht zuordenbare Unterschiede:** S1 rief CodeMap nie auf und brauchte trotzdem 11 % weniger Tokens
  und 8 % weniger Agentenzeit als K. Diese Unterschiede entstanden ohne CodeMap-Aufruf. Sie können vom
  anderen Prompttext oder aus der Streuung einzelner Läufe stammen; ein Lauf pro Arm trennt das nicht.
- **Fehlschläge:** Aufgaben 04 und 10 scheiterten in allen drei Armen, Aufgabe 06 nur in S0.
  Nachträglich festgestellt: Die versteckten Tests von 04 und 10 prüfen einen genauen Fehlertext, den
  der Prompt nicht nannte. Alle Arme änderten dort die richtige Datei. Die beiden Fehlschläge sagen also
  nichts über die Navigation; im [Folgevergleich](nameless-task-protocol.md) nennen die Prompts den Text.
- **Indexkosten:** Die Indexierung kostete je Lauf etwa 5,6 s. Sie macht die CodeMap-Arme in der
  Gesamtzeit langsamer als K, obwohl die Agenten dort schneller fertig waren.

## Grenzen

Ein Lauf pro Aufgabe und Arm, ein Repo, öffentlich bekannte Commits. Angefordert war `gpt-6-luna`
mit Effort `medium`; welches Modell tatsächlich antwortete, meldet die CLI nicht. Das Ergebnis ist
Entwicklungsevidenz für diese zwölf Aufgaben, deren Prompts die betroffene API benennen, und lässt sich
nicht verallgemeinern. Für Aufgaben ohne solche Namen, etwa Architekturfragen, ist nichts gemessen.
