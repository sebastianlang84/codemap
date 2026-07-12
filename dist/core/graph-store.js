import { readAllIndexedSourceTexts } from "./indexed-source.js";
import { extractLocalReferences, resolveIndexedReference } from "./local-references.js";
export const GRAPH_VERSION = "2";
const GRAPH_VERSION_KEY = "graph_version";
export function hasGraphMetadata(db) {
    const stored = db.prepare("select value from meta where key = ?").get(GRAPH_VERSION_KEY);
    return stored?.value === GRAPH_VERSION;
}
export function isGraphStale(db) {
    const stored = db.prepare("select value from meta where key = ?").get(GRAPH_VERSION_KEY);
    return stored?.value !== GRAPH_VERSION;
}
export function rebuildFileReferenceGraph(db) {
    const now = new Date().toISOString();
    ensureFileNodes(db, now);
    db.prepare("delete from graph_edges where kind in ('imports', 'includes')").run();
    const nodeIds = new Map(db.prepare("select id, path from graph_nodes where kind = 'file'").all().map((row) => [row.path, row.id]));
    const insertEdge = db.prepare(`
    insert into graph_edges(from_node_id, to_node_id, kind, source_file_id, extractor, line_start, line_end, specifier, evidence_key, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    for (const source of readAllIndexedSourceTexts(db)) {
        const fromNodeId = nodeIds.get(source.path);
        if (!fromNodeId)
            continue;
        for (const reference of extractLocalReferences(source.text, source.language, source.path)) {
            const targetPath = resolveIndexedReference(db, source.path, source.language, reference, "%");
            if (!targetPath || targetPath === source.path)
                continue;
            const toNodeId = nodeIds.get(targetPath);
            if (!toNodeId)
                continue;
            const edgeKind = reference.kind === "include" ? "includes" : "imports";
            insertEdge.run(fromNodeId, toNodeId, edgeKind, source.id, extractorFor(source.language, source.path, reference.kind), reference.lineStart ?? null, reference.lineEnd ?? null, reference.specifier, `${source.path}:${edgeKind}:${reference.specifier}:${targetPath}:${reference.lineStart ?? ""}`, now, now);
        }
    }
    db.prepare("insert or replace into meta(key, value) values (?, ?)").run(GRAPH_VERSION_KEY, GRAPH_VERSION);
}
export function outgoingGraphDependencies(db, fromPath, pathFilter) {
    return db.prepare(`
    select e.kind, source.path as sourcePath, target.path as targetPath, e.specifier
    from graph_edges e
    join graph_nodes source on source.id = e.from_node_id
    join graph_nodes target on target.id = e.to_node_id
    where source.path = ? and target.path like ? escape '\\' and e.kind in ('imports', 'includes')
    order by coalesce(e.line_start, 2147483647), target.path
    limit 16
  `).all(fromPath, pathFilter).map(toGraphDependency);
}
export function incomingGraphDependencies(db, targetPath, pathFilter) {
    return db.prepare(`
    select e.kind, source.path as sourcePath, target.path as targetPath, e.specifier
    from graph_edges e
    join graph_nodes source on source.id = e.from_node_id
    join graph_nodes target on target.id = e.to_node_id
    where target.path = ? and source.path like ? escape '\\' and e.kind in ('imports', 'includes')
    order by source.path
    limit 16
  `).all(targetPath, pathFilter).map(toGraphDependency);
}
function ensureFileNodes(db, now) {
    db.prepare("delete from graph_nodes where kind <> 'file' or file_id not in (select id from files)").run();
    const files = db.prepare("select id, path from files order by path").all();
    const upsertNode = db.prepare(`
    insert into graph_nodes(kind, ref, name, file_id, path, created_at, updated_at)
    values ('file', ?, ?, ?, ?, ?, ?)
    on conflict(ref) do update set name = excluded.name, file_id = excluded.file_id, path = excluded.path, updated_at = excluded.updated_at
  `);
    for (const file of files) {
        upsertNode.run(`file:${file.path}`, file.path, file.id, file.path, now, now);
    }
}
function extractorFor(language, path, kind) {
    const lowerPath = path.toLowerCase();
    if (kind === "include")
        return "cpp-include-regex";
    if (language === "python" || language === "py" || lowerPath.endsWith(".py"))
        return "python-relative-import-regex";
    return "ts-js-local-import-regex";
}
function toGraphDependency(row) {
    return {
        kind: row.kind === "includes" ? "include" : "import",
        sourcePath: row.sourcePath,
        targetPath: row.targetPath,
        specifier: row.specifier,
    };
}
