/** Offline adapters; product ranking and runtime interfaces remain unchanged. */
import { readFileSync } from "node:fs";
import { openRepoDb } from "../src/core/db.ts";
import { planQuery } from "../src/core/query-plan.ts";
import { rankAndSlice, toScoredCandidate, type SearchRow } from "../src/core/ranking.ts";
import { getRepoInfo } from "../src/core/repo.ts";
import { searchCodeMapWithDiagnostics } from "../src/core/search.ts";
import type { SearchResult } from "../src/core/types.ts";

interface Request {
  profile: "plan" | "codemap" | "bm25" | "codemap_fts";
  query: string;
  root?: string;
  state?: string;
  limit?: number;
}

const request = JSON.parse(readFileSync(0, "utf8")) as Request;
if (typeof request.query !== "string" || !request.query.trim()) throw new Error("query required");
const plan = planQuery(request.query);
const ftsQuery = plan.terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
if (!ftsQuery) throw new Error("No FTS terms");

if (request.profile === "plan") {
  process.stdout.write(JSON.stringify({ terms: plan.terms, ftsQuery }) + "\n");
} else {
  if (!request.root || !request.state) throw new Error("Explicit root and state required");
  if (!["codemap", "bm25", "codemap_fts"].includes(request.profile)) throw new Error("Unknown profile");
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("limit must be 1..10");
  const options = { cwd: request.root, stateDir: request.state, query: request.query, limit };
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new Error("Index approval missing");
  const db = openRepoDb(info.dbPath);
  try {
    const indexedPaths = (db.prepare("select path from files order by path").all() as Array<{ path: string }>)
      .map((row) => row.path);
    if (request.profile === "codemap") {
      const response = searchCodeMapWithDiagnostics(options);
      process.stdout.write(JSON.stringify({
        terms: plan.terms, ftsQuery, candidates: response.results,
        indexedPaths, nativeResponse: JSON.stringify(response, null, 2) + "\n",
      }) + "\n");
    } else {
      // Both profiles share this exact pool. No symbol table or query-tier score mixing.
      const rows = db.prepare(`
        select f.path, f.language, c.start_line as startLine, c.end_line as endLine,
               c.kind, c.text, bm25(chunks_fts) as rank, f.size as size
        from chunks_fts
        join chunks c on c.id = chunks_fts.rowid
        join files f on f.id = c.file_id
        where chunks_fts match ?
        order by rank, f.path, c.start_line, c.id
        limit 500
      `).all(ftsQuery) as unknown as SearchRow[];
      const scored = rows.map((row) => toScoredCandidate(row, plan, 0).result);
      let candidates: SearchResult[];
      if (request.profile === "codemap_fts") {
        candidates = rankAndSlice(scored, limit);
      } else {
        const seen = new Set<string>();
        candidates = [];
        for (let i = 0; i < rows.length; i++) {
          if (seen.has(rows[i].path)) continue;
          seen.add(rows[i].path);
          candidates.push({ ...scored[i], score: -rows[i].rank });
          if (candidates.length === limit) break;
        }
      }
      process.stdout.write(JSON.stringify({
        terms: plan.terms, ftsQuery, candidates, indexedPaths,
        poolSize: rows.length,
        pool: rows.map(({ path, startLine, endLine, rank }) => ({ path, startLine, endLine, rank })),
        nativeResponse: JSON.stringify({ results: candidates }, null, 2) + "\n",
      }) + "\n");
    }
  } finally {
    db.close();
  }
}
