create table if not exists graph_nodes (
  id integer primary key,
  kind text not null,
  ref text not null unique,
  name text not null,
  file_id integer references files(id) on delete cascade,
  path text,
  created_at text not null,
  updated_at text not null
);

create table if not exists graph_edges (
  id integer primary key,
  from_node_id integer not null references graph_nodes(id) on delete cascade,
  to_node_id integer not null references graph_nodes(id) on delete cascade,
  kind text not null,
  source_file_id integer references files(id) on delete cascade,
  extractor text not null,
  line_start integer,
  line_end integer,
  specifier text,
  evidence_key text not null,
  created_at text not null,
  updated_at text not null,
  unique(from_node_id, to_node_id, kind, evidence_key)
);

create index if not exists graph_edges_from_kind on graph_edges(from_node_id, kind);
create index if not exists graph_edges_to_kind on graph_edges(to_node_id, kind);
create index if not exists graph_edges_source_file on graph_edges(source_file_id);
create index if not exists graph_nodes_kind_path on graph_nodes(kind, path);
