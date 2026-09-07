# Agentenvergleich: eingefrorene Fallgruppen

Stand: 2026-09-07. Vorbereitung für Paket 1 der [Roadmap](../product/roadmap.md).
Noch keine Modellläufe oder CodeMap-Ausgaben für diese Aufgaben beobachtet.

## Auswahl und Trennung

24 neue historische Aufgaben: zwei Gruppen mit je zwölf Fällen, jeweils vier aus
Express, Fastify und Flask. Die lokalen Entwicklungsfälle eines getrennten Agents
verwenden ausschließlich frühere Manifestaufgaben und überschneiden sich nicht.

Die Vorbereitung durchsuchte je Repo bis zu 1.000 erreichbare Nicht-Merge-Commits
und erfasste zunächst höchstens 35 Treffer mit Implementierungs- und Teständerungen.
Danach folgte eine manuelle Machbarkeitsprüfung: begrenzte Verhaltensänderung, eigenständige
Regressionstests, vorhandene Laufzeit und fixierbare Abhängigkeiten. Breite Migrationen,
Abhängigkeitsupdates und Änderungen ohne reproduzierbaren Basisfehler entfielen.
Frühere Manifestaufgaben sowie gleiche Implementierungspatches unter anderen SHAs
wurden ausgeschlossen. Dies ist eine Machbarkeitsstichprobe, keine Zufallsstichprobe.

27 Kandidaten wurden ausgeführt. Zwei zeigten keinen Basisfehler; ein weiterer
änderte bestehende öffentliche Testerwartungen. Die übrigen 24 wurden übernommen.
Alle Auswahlentscheidungen erfolgten vor Produktmessungen und Modellbeobachtungen.
Die vorbereitenden Prüfläufe dürfen nur Ausführbarkeit und Oracle-Eignung entscheiden.

Je Repo wurden die acht geeigneten Fix-SHAs sortiert und abwechselnd Entwicklung und
Bestätigung zugeteilt. Eine Familie der Routenregistrierung überschritt zunächst die
Obergrenze. Ihr kleinster Bestätigungs-SHA wurde mit dem größten Entwicklungs-SHA einer
anderen Familie getauscht. Danach enthält keine Gruppe mehr als zwei Aufgaben derselben
API-/Fehlerfamilie. Innerhalb jeder Gruppe wechseln die Repos; die Armreihenfolge rotiert.

Die Entwicklungsaufgaben stehen im Entwicklungsmanifest. Das Bestätigungsmanifest und
seine Detailprotokolle bleiben für Implementierer bis zum eingefrorenen Kandidaten und
bestandenen Entwicklungs-Gate geschlossen. Vorher werden nur Anzahl, Integrität und
Oracle-Gesamtergebnis weitergegeben. Ein fehlgeschlagener Entwicklungslauf öffnet die
Bestätigung nicht. Ein fehlgeschlagener Bestätigungslauf erlaubt keine Nachoptimierung.

## Reproduzierbarkeit

Die Quellenlinks zeigen direkt auf den jeweiligen Fix-Commit; eine PR-Zuordnung
wird nicht vorausgesetzt. Jedes Manifest enthält Basis-/Fix-Commits, Verhaltensauftrag,
verdeckte Testpfade, öffentlichen Testbefehl, Installationsbefehl und Nachweise der Vorbereitung.
Die öffentlichen Befehle bestehen auf unveränderter Basis und vollständiger Referenz.
Sie enthalten keine verdeckten Assertions oder Lösungsausschnitte. Neue Testdateien
verwenden als öffentliche Hilfe passende bereits vorhandene Tests.

Die verdeckten Tests scheitern pro Fall zweimal auf der Basis am benannten Verhalten
und bestehen zweimal auf der vollständigen Referenz. Die abschließende Vorbereitung
prüft zusätzlich die eingefrorenen Installationsbefehle. NPM verwendet beigefügte,
SHA-256-geprüfte Lockfiles und `npm ci`; Python verwendet vorhandene Upstream-Locks
oder vollständig versionsgebundene Testanforderungen ohne weitere Abhängigkeitsauflösung.
Python ist auf 3.14.2 festgelegt. Die Hostwerkzeuge waren Node 22.23.2, npm 10.9.8 und
uv 0.12.10; der Python-Launcher war 3.13.5. Log-Hashes und Abhängigkeitspins stehen
bei den Aufgaben. Rohprotokolle bleiben im privaten CodeMap-Cache.

## Ausführung und Entscheidung

Der Produkt-SHA ist zunächst nur ein Platzhalter. Erst nach einem lokalen Gewinner
werden Produktstand und Navigationsanweisung eingefroren. Aufgaben, Testhilfe und
Schwellen bleiben unverändert. Die Runner-Integration wird vor Modellaufrufen geprüft.

Luna medium, bestehendes Codex-Abonnement, höchstens 15 Minuten je Versuch. Maximal
48 reguläre Aufrufe und zwei Infrastruktur-Ersatzversuche für beide Gruppen zusammen.
Vor der Bestätigung wird deren Ersatzbudget um bereits verbrauchte Ersatzversuche
reduziert. Alle Versuche einschließlich ersetzter Infrastrukturfehler werden berichtet.
Keine Wiederholung schlechter Ergebnisse und kein Providerwechsel.

Jede Gruppe muss unabhängig bestehen: zwölf gültige Paare, keine gepaarten
Korrektheitsverluste, mindestens 15 % weniger gesamte Agentenzeit, Tokenverhältnis
höchstens 1,10 und mindestens acht schnellere Aufgaben. Setup, Indexierung, Navigation
und Tests werden zusätzlich getrennt berichtet; Testzeit bleibt in der Agentenzeit.
Die Schwellen sind technische Entscheidungskriterien, kein Signifikanznachweis.
