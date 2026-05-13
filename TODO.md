# TODO

## Backlog

- [ ] Statuszeile für nicht indexierte Repos verbessern: eigenen Zustand anzeigen (weder Haken noch X), z.B. „CodeMap ○“ / „not indexed“.
- [ ] Prompt-Injections der Extension optimieren: `promptSnippet`/`promptGuidelines` prüfen, kürzen, präzisieren und gegen Kontext-Bloat absichern.

## Review-Funde vom TDD-Review

- [x] `src/core/index-health.ts`: `pathPrefix` in SQL-`LIKE` literal escapen (`ESCAPE '\\'`), damit `_`/`%` in echten Verzeichnisnamen nicht als Wildcards zählen. TDD-Slice: Repo mit `services/api_v1/` und `services/apiXv1/`; `status(..., { pathPrefix: "services/api_v1" })` darf nur exakt `api_v1` zählen.
- [x] `src/core/scanner.ts`: `pathPrefix` mit internen `..`-Segmenten rejecten oder kanonisch normalisieren. TDD-Slice: `src/../docs` muss konsistent als ungültig gewarnt oder zu `docs/` normalisiert werden, damit Scan, DB-Filter, Suche, Status und Deletion nicht auseinanderlaufen.

## Erledigt

Alle Architektur-Vertiefungen aus dieser Liste wurden umgesetzt.

- [x] Unified CodeMap operation surface (`src/pi-extension/operations.ts` als Katalog; `tools.ts`/`commands.ts` als Adapter)
- [x] Index health as its own deeper Module (`src/core/index-health.ts`)
- [x] Search retrieval pipeline (`src/core/search-pipeline.ts`)
- [x] Index update ownership (`src/core/index-store.ts` owns version/force-reindex/update metadata)
- [x] Repository scan policy (`src/core/scan-policy.ts`)
