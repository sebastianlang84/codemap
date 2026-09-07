# Aktueller CodeMap-Stand im Agentenvergleich

2026-09-08. **Effizienz-Gate verfehlt; kein verlässlicher Zusatznutzen belegt.**
Alle zwölf Paare wurden ausgeführt. Die unabhängige Bestätigung bleibt geschlossen.
[Protokoll](agent-impact-program-protocol.md#neuer-auftrag-bestehenden-produktnutzen-prüfen),
[Messdaten](agent-impact-current-development-result.json),
[Auswertung](agent-impact-current-development-analysis.json),
[Ablaufprüfung](agent-impact-current-navigation-audit.json).

| Metrik | Normale Suche | CodeMap |
| --- | ---: | ---: |
| Verdeckte Verhaltenstests bestanden | 12/12 | 12/12 |
| Gesamte Agentenzeit | 1.041,7 s | 989,4 s (−5,0 %) |
| Gesamte Tokens einschließlich Cache | 3.605.735 | 3.226.529 (−10,5 %) |
| Befehlsaufrufe | 98 | 136 |
| Befehle vor erster gemeldeter Dateiänderung | 48 | 90 |

CodeMap ist 4/12-mal schneller, verlangt waren mindestens acht und mindestens
15 % weniger Gesamtzeit. Token- und ursprüngliches Korrektheitskriterium bestehen.
Die 95%-Bootstrapintervalle für CodeMap/Normal sind Zeit **0,713–1,237** und Tokens
**0,576–1,298**; beide enthalten 1. Gezogene Paare bleiben innerhalb ihres Repos.
Die Median-Aufgabe braucht mit CodeMap 13,9 % mehr Zeit.

Je Repo: Express +20,3 % Zeit / +16,0 % Tokens; Fastify −11,3 % / −17,5 %;
Flask −11,4 % / −8,9 %. Vier Fälle pro Repo erlauben keine belastbare Einsatzsegmentierung.

## Befunde aus Patches und Abläufen

- Zwölf Such- und vierzehn Kontextaufrufe; zwei konstruierte Zeilenbereiche passen
  nicht zu einem Chunk und werden korrigiert. Vollständige richtige Funktionen werden
  mehrfach anschließend erneut gelesen. Die zusätzlichen Schritte ersetzen normale
  Suche nicht zuverlässig; Befehlszahlen sind keine Navigationsdauer.
- Zwei Kontextantworten enthalten je 514 Zeilen. Kleinere, aufgabenbezogene Bereiche
  sind eine plausible Entwicklungshypothese, noch kein gemessener Produktgewinn.
- Die zwei größten Zeitgewinne stammen aus Dekoratoren und Schema-Coercion. Beim
  Dekorator-Patch fehlen jedoch Typüberladungen. Eine nachgelagerte identische
  [Typprüfung](agent-impact-current-typecheck.json) besteht auf Basis und normalem
  Agentenpatch; der CodeMap-Patch führt zwei Rückgabetypfehler ein. Der Agent hat dort
  keine Typprüfung ausgeführt. Das ursprüngliche Gate wurde nicht nachträglich geändert.
- 24/24 Rohverbrauchswerte, Laufzeiten und Originalpatch-Hashes stimmen mit den
  Messdaten überein. 234 Befehlsereignisse sind geprüft; keine fremden Lösungsquellen
  oder CodeMap-Nutzung im Kontrollarm beobachtet. Null Infrastruktur-Ersatzversuche.

## Konsequenz und Grenzen

Der angeleitete Zweischritt-Ablauf ist für diese Aufgaben nicht als Standard belegt.
Der nächste begründete Ansatz ist ein kompakter Aufruf mit Aufgabenfrage und bekannter
Fundstelle, der gezielt fehlende Bereiche ergänzt und Folgesuche ersetzt. Vor einer
weiteren Agentenserie muss dieser Ablauf lokal geprüft werden; Typprüfungen gehören
bei typisierten API-Aufgaben zur Qualitätskontrolle. Das eingebundene CodeMap-Profil
muss vorher auf Laufzeitdateien begrenzt werden. Keine weitere Modellserie gestartet.

Produkt und Runner: `1f348c4`; Luna medium, tatsächliche Antwortmodell-ID unberichtet.
Gleiche öffentliche Testhilfe nennt bereits Testdateien. Machbarkeitsstichprobe aus drei
Repos, ein Versuch je Arm; Intervalle erfassen keine wiederholte Modellstreuung.
Indexierung: insgesamt 3,994 s, außerhalb der Agentenzeit. Setup/Preflight/Verifier
separat ausgewiesen; Testzeit im Agentenlauf bleibt enthalten. Tokens sind keine
Abonnementabrechnung. Werkzeugzeiten messen gepufferten JSONL-Empfang; geteilte Hostlast
wurde erfasst. Ursprüngliche Patches und Traces bleiben im privaten CodeMap-Cache.

Das vollständige CodeMap-Profil einschließlich Eval-Dateien war lesbar eingebunden.
Fremde Dateien waren per Auftrag verboten, aber nicht sämtlich technisch verborgen.
Kein solcher Zugriff ist in den Befehlen erkennbar; das ist keine vollständige
Dateisystem- oder Netzwerkbeobachtung. Produktcode, Version und Installation unverändert.
