/** Frozen-pool offline ablations; no product mutations. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { indexRepo } from "../src/core/indexer.ts";
import { openRepoDb } from "../src/core/db.ts";
import { planQuery } from "../src/core/query-plan.ts";
import { rankAndSlice } from "../src/core/ranking.ts";
import { collectSearchCandidateDiagnostics, type SearchCandidateDiagnostic } from "../src/core/search-pipeline.ts";
import { searchCodeMap } from "../src/core/search.ts";
import { buildCodeMapContext, type CodeMapReadFirstItem } from "../src/core/context-builder.ts";
import { explainSearchContextReadPlan } from "../src/core/navigation-read-plan.ts";
import { functionChunkAtLine, snippet } from "../src/core/chunker.ts";
const request = JSON.parse(readFileSync(0, "utf8"));
const options = { cwd: request.root, stateDir: request.state };
const indexed = indexRepo({ ...options, approve: true });
const db = openRepoDb(indexed.dbPath);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  const plan = planQuery(request.query);
  const prefix = collectSearchCandidateDiagnostics(db, { plan, limit: 5, pathFilter: "%" });
  const expanded = collectSearchCandidateDiagnostics(db, { plan, limit: 50, pathFilter: "%" });
  function search(ablate: boolean) {
    const scores = (rows: SearchCandidateDiagnostic[]) => rows.map(({ result, scoreDiagnostics }) => ({ ...result,
      score: result.score - (ablate ? scoreDiagnostics.ftsScore : 0) }));
    const first = rankAndSlice(scores(prefix), 5);
    const seen = new Set(first.map(item => item.path));
    return [...first, ...rankAndSlice(scores(expanded), 50).filter(item => !seen.has(item.path))].slice(0, 10);
  }
  const baselineSearch = search(false);
  assert.deepEqual(baselineSearch, searchCodeMap({ ...options, query: request.query, limit: 10 }));
  const searchHits = searchCodeMap({ ...options, query: request.query, limit: 8 });
  assert.ok(searchHits.length);
  const anchored = buildCodeMapContext({ ...options, target: searchHits[0].path, limit: 8 });
  const native = buildCodeMapContext({ ...options, target: request.query, limit: 8 });
  assert.equal(native.targetForm, "query");
  const pool = new Map<string, CodeMapReadFirstItem>();
  for (const item of anchored.readFirst) if (!pool.has(item.path)) pool.set(item.path, item);
  for (const item of searchHits) {
    const row = db.prepare(`select c.start_line as startLine, c.end_line as endLine, c.kind, c.text
      from files f join chunks c on c.file_id = f.id where f.path = ? and c.start_line <= ? and c.end_line >= ?
      order by c.start_line desc, c.ordinal limit 1`).get(item.path, item.startLine, item.endLine) as
      { startLine: number; endLine: number; kind: string; text: string } | undefined;
    let matched: CodeMapReadFirstItem = item;
    if (row) {
      const inner = item.kind === "function" && item.startLine === item.endLine && item.startLine > row.startLine
        ? functionChunkAtLine(row.text, item.language, item.startLine - row.startLine + 1) : undefined;
      matched = inner ? { ...item, startLine: row.startLine + inner.startLine - 1,
        endLine: row.startLine + inner.endLine - 1, kind: inner.kind, text: inner.text, snippet: snippet(inner.text) }
        : { ...item, ...row, snippet: snippet(row.text) };
    }
    pool.set(item.path, matched);
  }
  const baselinePaths = explainSearchContextReadPlan(searchHits.map(item => item.path), anchored.readFirst, 8).selected;
  const simplerPaths = [...new Set([...searchHits.map(item => item.path), ...anchored.readFirst.map(item => item.path)])].slice(0, 8);
  const pick = (paths: string[]) => paths.map(path => pool.get(path)!);
  const strip = (items: CodeMapReadFirstItem[]) => items.map(item => ({ path: item.path, startLine: item.startLine,
    endLine: item.endLine, text: "text" in item ? item.text : undefined, kind: item.kind }));
  assert.deepEqual(strip(pick(baselinePaths)), strip(native.readFirst));
  const withoutText = (items: CodeMapReadFirstItem[]) => items.map(item => ({ path: item.path,
    startLine: item.startLine, endLine: item.endLine, kind: item.kind }));
  process.stdout.write(JSON.stringify({
    search: { poolSha256: hash({ prefix, expanded }), poolSizes: [prefix.length, expanded.length],
      baseline: baselineSearch, ablated: search(true) },
    context: { poolSha256: hash(strip([...pool.values()])), poolSize: pool.size,
      baseline: withoutText(pick(baselinePaths)), ablated: withoutText(pick(simplerPaths)) },
    nativeParity: true,
  }) + "\n");
} finally { db.close(); }
