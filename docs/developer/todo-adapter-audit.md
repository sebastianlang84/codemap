# Sichtbare Kontextausgabe

2026-09-08, Codeprüfung auf `fd27c82`; [Messdaten](todo-adapter-audit.json).

CLI-Text liefert Positionen, CLI-JSON enthält Quelltext. MCP liefert Positionen
im Text und Quelltext in `structuredContent`. Pi liefert Quelltext im Tooltext
und in den Details; die gekürzte UI-Anzeige ist nicht die Werkzeugantwort.
Die tatsächliche Modellansicht eines MCP- oder Pi-Hosts wurde nicht geprüft.

In 24 historischen Codex-CLI-Traces stehen 234 Befehle und 14 Kontextaufrufe,
alle mit JSON angefordert. Elf Antworten enthalten auswertbaren Quelltext;
zwei Aufrufe scheitern, einer endet ohne Ausgabe. Keine expliziten
Kürzungsmarker; unsichtbare Kürzungen durch den Host sind nicht ausgeschlossen.

Vor der ersten Dateiänderung wiederholen 17 spätere Lesebefehle in elf Läufen
nachweislich bereits ausgegebene Zeilen. Fünf lesen einen vollständigen
Ausschnitt erneut. Gezählt wurden nur exakt passende `sed`-Ausgaben und
`rg`-Zeilentreffer. Das belegt Wiederholung, weder 17 vermeidbare Befehle noch
eine bezifferbare Zeitersparnis. Die Zuordnung bleibt durch Trace-Hashes und
Quellpositionen prüfbar; Rohtraces bleiben außerhalb des Repos.
