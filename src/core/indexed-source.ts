import { openRepoDb } from "./db.ts";

export interface IndexedSourceText {
  id: number;
  path: string;
  language: string;
  text: string;
}

interface IndexedSourceChunkRow {
  id: number;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  ordinal: number;
  text: string;
}

export function readAllIndexedSourceTexts(db: ReturnType<typeof openRepoDb>): IndexedSourceText[] {
  const rows = db.prepare(`
    select f.id, f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.ordinal, c.text
    from files f join chunks c on c.file_id = f.id
    order by f.path, c.ordinal
  `).all() as unknown as IndexedSourceChunkRow[];
  const byPath = groupRowsByPath(rows);
  return [...byPath.values()].map((sourceRows) => ({
    id: sourceRows[0].id,
    path: sourceRows[0].path,
    language: sourceRows[0].language,
    text: reconstructChunkedText(sourceRows),
  }));
}

export function readIndexedSourceText(db: ReturnType<typeof openRepoDb>, path: string): IndexedSourceText | undefined {
  const rows = db.prepare(`
    select f.id, f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.ordinal, c.text
    from files f join chunks c on c.file_id = f.id
    where f.path = ?
    order by c.ordinal
  `).all(path) as unknown as IndexedSourceChunkRow[];
  if (rows.length === 0) return undefined;
  return { id: rows[0].id, path: rows[0].path, language: rows[0].language, text: reconstructChunkedText(rows) };
}

function groupRowsByPath(rows: IndexedSourceChunkRow[]): Map<string, IndexedSourceChunkRow[]> {
  const byPath = new Map<string, IndexedSourceChunkRow[]>();
  for (const row of rows) {
    const sourceRows = byPath.get(row.path) ?? [];
    sourceRows.push(row);
    byPath.set(row.path, sourceRows);
  }
  return byPath;
}

function reconstructChunkedText(rows: IndexedSourceChunkRow[]): string {
  const lines: string[] = [];
  let maxLine = 0;
  for (const row of rows) {
    const chunkLines = row.text.split(/\r?\n/);
    maxLine = Math.max(maxLine, row.endLine);
    for (let index = 0; index < chunkLines.length && row.startLine + index <= row.endLine; index++) {
      const lineIndex = row.startLine + index - 1;
      lines[lineIndex] ??= chunkLines[index];
    }
  }
  return lines.slice(0, maxLine).map((line) => line ?? "").join("\n");
}
