import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export function openRepoDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
  migrate(db);
  return db;
}

// Bump whenever the migration files or the normalize steps below change so already-stamped databases
// re-run the full migration once. openRepoDb calls migrate() on every open, so the fast path avoids
// re-reading 3 migration files + probing sqlite_master/pragma on every codemap_* operation.
const SCHEMA_VERSION = "1";

export function migrate(db: DatabaseSync): void {
  if (schemaIsCurrent(db)) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "..", "..", "migrations");
  const files = ["001_init.sql", "002_fts.sql", "003_graph.sql"];
  for (const file of files) {
    const path = join(migrationsDir, file);
    if (existsSync(path)) db.exec(readFileSync(path, "utf8"));
    else db.exec(fallbackSql);
  }
  normalizeFtsSchema(db);
  normalizeGraphSchema(db);
  db.prepare("insert or replace into meta(key, value) values ('schema_version', ?)").run(SCHEMA_VERSION);
}

// True when this database has already been migrated to the current schema. Guards against a missing
// `meta` table (brand-new database) so the first open always runs the full migration.
function schemaIsCurrent(db: DatabaseSync): boolean {
  try {
    const hasMeta = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'meta'").get();
    if (!hasMeta) return false;
    const row = db.prepare("select value from meta where key = 'schema_version'").get() as { value: string } | undefined;
    return row?.value === SCHEMA_VERSION;
  } catch {
    return false;
  }
}

// Convert legacy content-owning FTS tables (which duplicate chunk/symbol text) to contentless
// FTS5. The search read path only uses the FTS index for MATCH/bm25 and joins back to
// chunks/symbols/files for display, so no stored FTS text is ever read. Repopulate from the base
// tables in the same step so search keeps working without a reindex.
function normalizeFtsSchema(db: DatabaseSync): void {
  const rows = db.prepare("select name, sql from sqlite_master where name in ('chunks_fts', 'symbols_fts')").all() as Array<{ name: string; sql: string | null }>;
  const sqlByName = new Map(rows.map((row) => [row.name, row.sql ?? ""]));
  const chunksLegacy = sqlByName.has("chunks_fts") && !sqlByName.get("chunks_fts")!.includes("contentless_delete");
  const symbolsLegacy = sqlByName.has("symbols_fts") && !sqlByName.get("symbols_fts")!.includes("contentless_delete");
  if (!chunksLegacy && !symbolsLegacy) return;
  db.exec("begin immediate");
  try {
    if (chunksLegacy) {
      db.exec(`
        drop table if exists chunks_fts;
        create virtual table chunks_fts using fts5(path, language, kind, text, content='', contentless_delete=1);
        insert into chunks_fts(rowid, path, language, kind, text)
          select c.id, f.path, f.language, c.kind, c.text from chunks c join files f on f.id = c.file_id;
      `);
    }
    if (symbolsLegacy) {
      db.exec(`
        drop table if exists symbols_fts;
        create virtual table symbols_fts using fts5(path, name, kind, signature, content='', contentless_delete=1);
        insert into symbols_fts(rowid, path, name, kind, signature)
          select s.id, f.path, s.name, s.kind, coalesce(s.signature, '') from symbols s join files f on f.id = s.file_id;
      `);
    }
    db.exec("commit");
  } catch (error) {
    try { db.exec("rollback"); } catch { /* already rolled back or not in transaction */ }
    throw error;
  }
}

function normalizeGraphSchema(db: DatabaseSync): void {
  const nodeColumns = tableColumns(db, "graph_nodes");
  const edgeColumns = tableColumns(db, "graph_edges");
  if (!nodeColumns.has("symbol_id") && !edgeColumns.has("scope") && !edgeColumns.has("confidence")) return;
  db.exec(`
    drop table if exists graph_edges;
    drop table if exists graph_nodes;
    delete from meta where key = 'graph_version';
  `);
  db.exec(reducedGraphSql);
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

const fallbackSql = `
  create table if not exists meta (key text primary key, value text not null);
  create table if not exists files (id integer primary key, path text not null unique, language text not null, size integer not null, hash text not null, mtime_ms real not null, indexed_at text not null);
  create table if not exists chunks (id integer primary key, file_id integer not null references files(id) on delete cascade, ordinal integer not null, start_line integer not null, end_line integer not null, kind text not null, text text not null, unique(file_id, ordinal));
  create table if not exists symbols (id integer primary key, file_id integer not null references files(id) on delete cascade, name text not null, kind text not null, start_line integer not null, end_line integer, signature text);
  create virtual table if not exists chunks_fts using fts5(path, language, kind, text, content='', contentless_delete=1);
  create virtual table if not exists symbols_fts using fts5(path, name, kind, signature, content='', contentless_delete=1);
  create table if not exists graph_nodes (id integer primary key, kind text not null, ref text not null unique, name text not null, file_id integer references files(id) on delete cascade, path text, created_at text not null, updated_at text not null);
  create table if not exists graph_edges (id integer primary key, from_node_id integer not null references graph_nodes(id) on delete cascade, to_node_id integer not null references graph_nodes(id) on delete cascade, kind text not null, source_file_id integer references files(id) on delete cascade, extractor text not null, line_start integer, line_end integer, specifier text, evidence_key text not null, created_at text not null, updated_at text not null, unique(from_node_id, to_node_id, kind, evidence_key));
  create index if not exists graph_edges_from_kind on graph_edges(from_node_id, kind);
  create index if not exists graph_edges_to_kind on graph_edges(to_node_id, kind);
  create index if not exists graph_edges_source_file on graph_edges(source_file_id);
  create index if not exists graph_nodes_kind_path on graph_nodes(kind, path);
`;

const reducedGraphSql = `
  create table if not exists graph_nodes (id integer primary key, kind text not null, ref text not null unique, name text not null, file_id integer references files(id) on delete cascade, path text, created_at text not null, updated_at text not null);
  create table if not exists graph_edges (id integer primary key, from_node_id integer not null references graph_nodes(id) on delete cascade, to_node_id integer not null references graph_nodes(id) on delete cascade, kind text not null, source_file_id integer references files(id) on delete cascade, extractor text not null, line_start integer, line_end integer, specifier text, evidence_key text not null, created_at text not null, updated_at text not null, unique(from_node_id, to_node_id, kind, evidence_key));
  create index if not exists graph_edges_from_kind on graph_edges(from_node_id, kind);
  create index if not exists graph_edges_to_kind on graph_edges(to_node_id, kind);
  create index if not exists graph_edges_source_file on graph_edges(source_file_id);
  create index if not exists graph_nodes_kind_path on graph_nodes(kind, path);
`;

export function readSql(path: string): string {
  return readFileSync(path, "utf8");
}
