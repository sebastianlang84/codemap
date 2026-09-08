# Vier Kontexthebel

Basis `ef10b97`, unverändertes Zwölf-Fall-Korpus und Runner. Neue Baseline wird vor
Kandidaten gemessen. Jeder Hebel hat genau einen Kandidaten; Varianten werden
nacheinander ausgeführt, ohne Produktänderung. Runner-Prototypen verwenden dieselben
öffentlichen lokalen Funktionen. Keine Modellaufrufe oder neuen Werkzeugparameter.

## Vorab festgelegte Algorithmen und Gates

1. **Mehrere Spannen:** Erste Basisspanne behalten; bis zu zwei bisher nicht enthaltene
   Funktions-, Klassen-, Typ-, Interface- oder Exporttreffer der ersten acht Suchhits
   vor den restlichen Basisspannen einfügen. Je Treffer den vorhandenen Ortskontext
   verwenden. Enthaltene Duplikate auslassen; restliche Basisreihenfolge erhalten.
2. **Gezielte Ausschnitte:** Dateiauswahl und Reihenfolge unverändert. Je Spanne
   höchstens 80 % ihrer Ausgangsbytes ausgeben. Längste zusammenhängende Zeilenfolge
   um die Zeile mit den meisten unterschiedlichen Querywörtern wählen; Gleichstand
   früheste Zeile. Erweiterung abwechselnd nach oben/unten, bis keine Seite mehr
   passt. Kein Teil einer Zeile, kein synthetischer Quelltext. Ziel: insgesamt
   mindestens 20 % weniger Quellbytes, keine verlorenen vollständigen Ziele/Pakete.
3. **Aufgabe und bekannte Fundstelle:** Ohne Ground-Truth-Zugriff den ersten Suchhit
   als entdeckte Fundstelle benutzen. Dessen Ortskontext liefert Dateireihenfolge;
   pro Datei den ersten Querytreffer wählen, falls vorhanden, sonst die Ortsspanne.
   Restliche Querybasisspannen auffüllen. Dies ist ein Workflow-Prototyp, keine
   Messung einer unabhängig vom Suchsystem gelieferten menschlichen Fundstelle.
4. **Unsicherer Anker:** Bei verschiedenen Dateien in den ersten zwei Suchhits und
   relativem Scoreabstand höchstens 10 % beide Ortskontexte berücksichtigen:
   erste Basisspanne, erste Spanne des zweiten Ankers, übrige Basis. Sonst unverändert.
   Scoregleichstand behält Suchreihenfolge. Zusätzlich vorab eingefrorene Varianten:
   Original, kleingeschrieben, umgekehrte Leerraumtokenfolge. Varianten messen nur
   Ankerstabilität und ändern weder Hauptabfrage noch erwartete Zielspannen.

Alle Kandidaten halten acht Ausschnitte und die jeweiligen Basis-Quellbytekappen
hart ein. Außer Hebel 2 sind mindestens zwei zusätzliche vollständige Zielfälle
erforderlich. Kein vollständiger Ziel- oder Paketverlust; exakte Quelltextspannen.
Nur lokale Gewinner gehen weiter zu sämtlichen bestehenden Gates einschließlich
Real-Repo. Fehlgeschlagene lokale Kandidaten werden verworfen; unveränderte
Produktgates wären für solche Prototypen kein Wirksamkeitsnachweis. Kein Retuning.
Die genauen Implementierungen bleiben als inaktives Skript erhalten. Kein Bump:
ausschließlich Entwicklungsevidenz, keine aktivierte Produktänderung.
