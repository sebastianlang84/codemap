# Code-Suche: Literatur und direkte Vergleiche

Geprüft am 2026-09-08. Gezielte Recherche, kein systematisches Review.
Websuche und OpenAlex-MCP; Originaltexte geprüft. OpenAlex bestätigt unter anderem
GrepRAG als W7127083551/W7127203308. Keine fremden Benchmarks lokal wiederholt.

| Quelle | Vergleich und Befund | Grenze |
| --- | --- | --- |
| [Russ Cox, 2012](https://swtch.com/~rsc/regexp/regexp4.html) | Trigrammindex gegen vollständigen Scan desselben Suchprogramms: Linux-Beispiel reduziert 36.972 Kandidatendateien auf 25 und Suchzeit um etwa Faktor 100. | Technischer Bericht, einzelne historische Abfragen; kein Vergleich mit modernem ripgrep und kein Agentenversuch. |
| [Entire, Mai 2026](https://entire.io/blog/improving-agentic-search-in-coding-agents) | Direkt ripgrep gegen indexiertes fff: Suchlatenz im Speed-Test median 14,7 → 1,7 ms, Agentenzeit 38,57 → 36,99 s. Breiter 60-Aufgaben-Vergleich: fff praktisch keine Zeitersparnis; geranktes pgr −3,8 % Zeit. | Herstellerstudie, ein Repo, Sonnet. Relevanzlabels aus vom Kontrollagenten gelesenen Dateien; Konfidenzintervalle zentraler Ranking-Differenzen enthalten null. Kein allgemeiner Patch-Erfolgsnachweis. |
| [Better Call Grep / GrepRAG, 2026](https://arxiv.org/html/2601.23254v3) | LLM-generierte ripgrep-Suche bereits mit Graph-Baselines vergleichbar. Identifiergewichtung und strukturbewusste Deduplizierung verbessern Codevervollständigung; gemeldet +7,04–15,58 % relativer Exact Match gegenüber bester Baseline auf CrossCodeEval. | Codevervollständigung, keine vollständigen Reparaturaufgaben. arXiv nennt ISSTA2026; keine Aussage über CodeMap. |
| [Agent Retrieval Bench, Juli 2026](https://arxiv.org/html/2607.24882v1) | 427 Fälle aus 25 Repos, davon 345 positive Suchfälle. Embeddings führen bei MRR/Recall, RepoMap bei gewichteter Kontextausbeute unter 8K Tokens; kein universeller Sieger. | Preprint, überwiegend Dateiauswahl. Statisches Grep ist kein kompetenter interaktiver Agent. Richtige Datei bedeutet nicht richtigen Quelltextbereich; keine Patch-Erfolgsmessung. |
| [CodeGrep, August 2026](https://arxiv.org/html/2608.05886v1) | Auf 500 SWE-Bench-Verified-Aufgaben verschlechtert BM25-Kontext den nachfolgenden OpenHands-Agenten leicht. Ein trainierter 14B-Suchagent erreicht 27,0 statt 25,8 % gelöste Aufgaben; auf 96 gemeinsam gelösten Fällen −15 % Tokens im nachfolgenden Agenten. | Preprint; trainierter Suchagent benutzt selbst grep/glob/read, kein einfacher Indexvergleich. Die oft genannten −19 % vergleichen unterschiedliche gelöste Teilmengen; kein daraus ableitbarer Gesamtkostenvorteil einschließlich Retrievers. |

## Bedeutung für CodeMap

Indexierung kann Scans stark beschleunigen. Daraus folgt weder besseres Ranking
noch eine effizientere vollständige Agentenaufgabe. Die Studien widersprechen einem
pauschalen Urteil, indexierte Suche sei Grep grundsätzlich unterlegen oder überlegen.

Für die nächste lokale Untersuchung drei Dinge getrennt messen: Kandidatenauswahl,
benötigte Quelltextbereiche im Budget und tatsächlich ersetzte Agentenschritte.
Grep-Baselines dürfen Suchbegriffe anhand der Ergebnisse ändern. Gesamterfolg und
vollständige Kosten bleiben die abschließenden Produktkriterien.

Eine feinere Nutzung von BM25 im CodeMap-Endranking ist eine eigene, bislang
ungeprüfte Hypothese; keine Quelle belegt, dass genau dieser Eingriff hilft.
[Unsere Ergebnisse](agent-impact-current-development-result.md) bleiben unverändert.
