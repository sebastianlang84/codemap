# Host-Ausgabe: Quelltext erreicht den Providerrequest

2026-09-08, CodeMap-Basis `ac8c4bd`. **Pi und Codex übertragen im geprüften Ablauf
den vollständigen Dummy-Funktionsblock.** Erfasst wurde der HTTP-Folgeauftrag der echten
lokalen Hosts an einen lokalen Stub. Kein echtes Modell wurde aufgerufen.

| Host | Tatsächlich beobachteter Weg |
|---|---|
| Pi 0.80.6 | Tool-Ergebnis als JSON in `messages[].content`, Rolle `tool`; vollständiges `readFirst[].text` |
| Codex 0.153.4 | Code-Mode-Ausgabe als Text in `custom_tool_call_output`; darin vollständiges `structuredContent.readFirst[].text` |

Die Quelldatei hat 1.300 Bytes, der vollständige indexierte Funktionsblock 1.299 Bytes
(ohne abschließenden Zeilenumbruch). Ein eindeutiger Marker hinter dem 700-Zeichen-Snippet
fehlt im ersten Request und steht im Tool-Ergebnis des Folgeauftrags. Der vollständige
Block wurde zusätzlich exakt verglichen. [Messdaten und Payloadhashes](todo-host-output-result.json).

**Codex-Grenze:** Der Stub veranlasste im Code-Mode ausdrücklich
`text(await tools.mcp__codemap__codemap_context({target:"probe.ts"}));`.
Der echte MCP-Aufruf wurde erfolgreich abgeschlossen; dieser Aufruf reicht das komplette
Ergebnis einschließlich strukturierter Daten weiter. Eine automatische Weitergabe bei
jedem anderen Aufruf oder bei direktem MCP ohne Code-Mode ist damit nicht bewiesen.
Ebenso wenig belegt die Übertragung, dass ein echtes Modell den Inhalt korrekt nutzt.

## Isolation und Prüfung

Beide Hosts liefen mit frischem HOME und leerem, explizit aufgebautem Environment.
Die Netzwerknamensräume enthielten ausschließlich ihren eigenen Loopback-Stub;
vorhandene Benutzerkonfigurationen und Authdateien wurden nicht eingebunden.
Nur Dummy-Auth und eine isolierte, vorab indexierte Fixture wurden verwendet.
Produktcode und globale Hostkonfiguration bleiben unverändert.

Der erste Codex-Versuch war wegen fehlendem `codex-code-mode-host` im isolierten
Dateisystem ungültig. Im zweiten Ansatz wurde der Stubparser für Codex'
`additional_tools` korrigiert; dessen sechs lokalen HTTP-Retries waren keine Modellaufrufe.
Diese Fehlversuche zählen nicht als negative Quelltextbefunde. Vier Auswertungstests
prüfen vollständigen Inhalt, Snippet-Abgrenzung und die Trennung von Nutzer-/Tooltext.

```bash
python3 scripts/todo-host-output.py --output-dir "$HOME/.cache/codemap/todo-host-output-repeat"
python3 scripts/todo-host-output-test.py
```

Das Ausgabeziel muss neu sein. Benötigt werden die lokalen Pi-Abhängigkeiten, Codex
samt benachbartem Code-Mode-Host und Bubblewrap mit Benutzernamensräumen.
Die Rohrequests verbleiben im angegebenen Cacheziel; Zeitstempel und IDs ändern ihre
Hashes bei einer Wiederholung. Es gibt keine Aussage zu anderen Hostversionen.
