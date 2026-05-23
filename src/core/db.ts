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

export function migrate(db: DatabaseSync): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "..", "..", "migrations");
  const files = ["001_init.sql", "002_fts.sql", "003_graph.sql"];
  for (const file of files) {
    const path = join(migrationsDir, file);
    if (existsSync(path)) db.exec(readFileSync(path, "utf8"));
    else db.exec(fallbackSql);
  }
  normalizeGraphSchema(db);
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
  create virtual table if not exists chunks_fts using fts5(path, language, kind, text);
  create virtual table if not exists symbols_fts using fts5(path, name, kind, signature);
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
