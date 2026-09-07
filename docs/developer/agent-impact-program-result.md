# CodeMap-Arbeitsprogramm: Ergebnis

2026-09-07. [Auftrag und Grenzen](../product/roadmap.md#arbeitsprogramm-verlässlicher-nutzen-bei-code-aufgaben),
[Versuche](context-program-experiments.md), [Agentenprotokoll](agent-impact-program-protocol.md).

**Messgrundlage verbessert; kein neuer Produktkandidat übernommen.** Beide
Kontextansätze verbessern bekannte Entwicklungsfälle, verletzen jedoch bestehende
Gates. Deshalb wurden keine Agentenvergleiche gestartet. Die Bestätigungsaufgaben
bleiben für die Produktimplementierer versiegelt.

| Paket | Ergebnis |
| --- | --- |
| 1. Messgrundlage | Vorhandenen Runner ergänzt; zwölf lokale Fälle und 12+12 neue Agentenaufgaben eingefroren. |
| 2. Funktionsauswahl | Zwei Versuche durchgeführt und verworfen; keine Erwartungen gelockert. |
| 3. Aufgabenkontext | Machbarkeit anhand vorhandener Kanten und tatsächlicher Chunkgrößen geprüft; keine Implementierung. |
| 4. Nutzenprüfung | Wegen fehlenden lokalen Gewinners ausgelassen: null Modellaufrufe, null Ersatzversuche. |
| 5. Abschluss | Ergebnisse und verworfene Patches erhalten; keine Release-, Installations- oder globale Richtlinienänderung. |

Die lokale Ausgangsmessung erreicht 7/12 vollständige Ziele und definierte Pakete.
Lokale Aufrufauswahl verbessert Ziele auf 10/12, Pakete auf 8/12, scheitert aber an
zwei bestehenden Tests. Reines Erhalten verdrängter Funktionstreffer erreicht 9/12
Ziele und 8/12 Pakete; die Live-Repo-Prüfung scheitert. Gegen unverändertes Main
verschlechtert sie die Kontextabdeckung dreier Aufgaben. Beide exakten Patches
sind für Reproduktion archiviert und werden nicht vom Produkt geladen.

Der Messharness bewahrt vollständige Agentenpatches vor versteckten Teständerungen,
liefert beobachtete Werkzeugzeiten und getrennte Setup-/Preflight-/Verifier-Zeiten.
Öffentliche Testhilfe ist in beiden Armen gleich. Ersetzte Infrastrukturversuche
bleiben erhalten und begrenzt; erfolglose Aufgaben werden nicht wiederholt.

Ein zusätzlicher Laufzeitfehler wurde vor Modellaufrufen reproduziert und behoben:
uv-Python lag außerhalb des Containers. Jetzt wird ausschließlich dessen dedizierte
Installation lesbar eingebunden. Öffentliche Tests werden auch im tatsächlichen
Sandboxprofil geprüft, ohne Login-Kopie oder Modellaufruf.

[Abschlussprüfung](agent-impact-program-validation.json): alle 24 Aufgaben mit
zweimal Basisfehler und zweimal Referenzpass; öffentliche Tests auf beiden Ständen
bestanden. Zusätzlich 96/96 öffentliche Sandbox-Prüfungen über beide Varianten.
`npm run verify:local` besteht mit 313 Tests und sämtlichen Qualitätsgates.
Produktquellen und Build sind gegenüber dem Programmstart unverändert; kein
Versionsbump oder Release. Temporäre Produktworktrees sind entfernt.

Grenzen: historische Machbarkeitsstichprobe; die lokale Paketmetrik prüft bei
Begleitdateien nur Quellenpräsenz. Schon ein relevanter Dokumentationschunk des
Plugin-Falls überschreitet dessen gesamtes Bytebudget. Neue Dateikanten allein
beheben das nicht. Beobachtete Werkzeugzeiten können durch Ausgabepufferung
abweichen. Ohne Modellserie folgt kein neuer Beleg für Agentennutzen.
