export function buildArchitectureReport(db, pathFilter = "%", options = {}) {
    const limit = boundedLimit(options.limit ?? 10, 1, 50);
    const files = indexedFiles(db, pathFilter);
    const fileSet = new Set(files);
    const edges = graphEdges(db, pathFilter);
    const degree = degreeByPath(files, edges);
    return {
        pathFilter,
        highDegreeFiles: [...degree.values()]
            .filter((item) => item.total > 0)
            .sort(sortDegree)
            .slice(0, limit),
        bridgeFiles: [...degree.values()]
            .filter((item) => item.inbound > 0 && item.outbound > 0)
            .sort(sortDegree)
            .slice(0, limit),
        importCycles: stronglyConnectedComponents(files, edges)
            .filter((component) => component.length > 1)
            .map((paths) => ({ paths: paths.sort() }))
            .sort((left, right) => right.paths.length - left.paths.length || left.paths[0].localeCompare(right.paths[0]))
            .slice(0, limit),
        weaklyConnectedFiles: files
            .filter((path) => fileSet.has(path) && (degree.get(path)?.total ?? 0) === 0)
            .slice(0, limit),
        moduleClusters: moduleClusters(files, edges).slice(0, limit),
    };
}
function indexedFiles(db, pathFilter) {
    return db.prepare("select path from files where path like ? escape '\\' order by path").all(pathFilter).map((row) => row.path);
}
function graphEdges(db, pathFilter) {
    return db.prepare(`
    select source.path as sourcePath, target.path as targetPath, e.kind
    from graph_edges e
    join graph_nodes source on source.id = e.from_node_id
    join graph_nodes target on target.id = e.to_node_id
    where source.path like ? escape '\\' and target.path like ? escape '\\' and e.kind in ('imports', 'includes')
    order by source.path, target.path, e.kind
  `).all(pathFilter, pathFilter);
}
function degreeByPath(files, edges) {
    const degree = new Map(files.map((path) => [path, { path, inbound: 0, outbound: 0, total: 0 }]));
    for (const edge of edges) {
        const source = degree.get(edge.sourcePath);
        const target = degree.get(edge.targetPath);
        if (source)
            source.outbound++;
        if (target)
            target.inbound++;
    }
    for (const item of degree.values())
        item.total = item.inbound + item.outbound;
    return degree;
}
function sortDegree(left, right) {
    return right.total - left.total || right.inbound - left.inbound || right.outbound - left.outbound || left.path.localeCompare(right.path);
}
function stronglyConnectedComponents(files, edges) {
    const adjacency = new Map(files.map((path) => [path, []]));
    for (const edge of edges)
        adjacency.get(edge.sourcePath)?.push(edge.targetPath);
    for (const targets of adjacency.values())
        targets.sort();
    const indices = new Map();
    const lowlinks = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    let nextIndex = 0;
    function visit(path) {
        indices.set(path, nextIndex);
        lowlinks.set(path, nextIndex);
        nextIndex++;
        stack.push(path);
        onStack.add(path);
        for (const next of adjacency.get(path) ?? []) {
            if (!indices.has(next)) {
                visit(next);
                lowlinks.set(path, Math.min(lowlinks.get(path) ?? 0, lowlinks.get(next) ?? 0));
            }
            else if (onStack.has(next)) {
                lowlinks.set(path, Math.min(lowlinks.get(path) ?? 0, indices.get(next) ?? 0));
            }
        }
        if (lowlinks.get(path) !== indices.get(path))
            return;
        const component = [];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current)
                break;
            onStack.delete(current);
            component.push(current);
            if (current === path)
                break;
        }
        components.push(component);
    }
    for (const file of files)
        if (!indices.has(file))
            visit(file);
    return components;
}
function moduleClusters(files, edges) {
    const clusters = new Map();
    for (const file of files) {
        const module = moduleKey(file);
        const cluster = clusters.get(module) ?? { module, files: new Set(), edges: 0 };
        cluster.files.add(file);
        clusters.set(module, cluster);
    }
    for (const edge of edges) {
        const sourceModule = moduleKey(edge.sourcePath);
        const targetModule = moduleKey(edge.targetPath);
        const sourceCluster = clusters.get(sourceModule);
        if (sourceCluster)
            sourceCluster.edges++;
        if (targetModule !== sourceModule) {
            const targetCluster = clusters.get(targetModule);
            if (targetCluster)
                targetCluster.edges++;
        }
    }
    return [...clusters.values()]
        .map((cluster) => ({ module: cluster.module, files: cluster.files.size, edges: cluster.edges }))
        .sort((left, right) => right.files - left.files || right.edges - left.edges || left.module.localeCompare(right.module));
}
function moduleKey(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0)
        return ".";
    if ((parts[0] === "packages" || parts[0] === "apps") && parts.length >= 2)
        return `${parts[0]}/${parts[1]}`;
    return parts[0];
}
function boundedLimit(value, min, max) {
    const integer = Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.min(Math.max(integer, min), max);
}
