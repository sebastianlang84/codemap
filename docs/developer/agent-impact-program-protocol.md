# Agentenvergleich: eingefrorene Fallgruppen

Stand: 2026-09-07. Vorbereitung für Paket 1 der [Roadmap](../product/roadmap.md).
Neuer Auftrag vom 2026-09-07: aktuellen Produktstand mit den vorbereiteten Fällen prüfen.
Zum Einfrieren weiterhin keine Modellläufe oder CodeMap-Ausgaben für diese Aufgaben beobachtet.

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

Für eine spätere Ausführung vorab festgelegt: je Gruppe 10.000 gepaarte
Bootstrap-Ziehungen innerhalb jedes Repos, Seed 20260907, 95%-Perzentilintervalle
für das Verhältnis der summierten Agentenzeit und Tokens. Zusätzlich alle
Paarverhältnisse und Repo-Aggregate berichten. Die Intervalle beschreiben nur die
Streuung dieser ausgewählten Aufgaben, nicht wiederholter Modellantworten oder
aller Repos; sie ändern die eingefrorenen Entscheidungsschwellen nicht.

Programmabschluss: [Ergebnis und Grenzen](agent-impact-program-result.md).
Die beiden Produktkandidaten wurden verworfen. Die Fallgruppen bleiben vorbereitet;
Entwicklungs- und Bestätigungs-Modellläufe wurden nicht gestartet.

## Neuer Auftrag: bestehenden Produktnutzen prüfen

Der Nutzer hat nach Programmabschluss den Vergleich ausdrücklich gestartet.
Die Voraussetzung eines neuen lokalen Produktgewinners entfällt für diesen Auftrag;
Aufgaben, Testhilfe, Navigationsanweisung und sämtliche Schwellen bleiben unverändert.
Produkt und Runner sind `1f348c456f7efc13007a8372376e766d9d13272b`; Produktquellen und
Build stimmen mit dem vorbereiteten Ausgangsstand `298e25d` überein.
Gemessen wird der angeleitete location-first-Ablauf, keine freiwillige Werkzeugadoption.
Erst zwölf Entwicklungspaare, bei bestandenem Gate zwölf unabhängige Bestätigungspaare.
Bestätigung bleibt bis dahin versiegelt; dort werden nur Profil und verbleibendes
Infrastruktur-Ersatzbudget aktualisiert. Während der Serie keine Produktänderung.
Ergebnisse: `agent-impact-current-development-result.json` und kurzer Ergebnisbericht
im selben Verzeichnis. Modellzeit, Testzeit und Suchverläufe werden gemeinsam beurteilt;
eine nachträgliche Auswahl günstiger Aufgaben ersetzt das Gate nicht.

[Vergleich abgeschlossen](agent-impact-current-development-result.md): 24 reguläre Aufrufe,
keine Ersatzversuche; Entwicklungs-Gate verfehlt, Bestätigung nicht gestartet.
