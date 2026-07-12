import { posix } from "node:path";
import { tsJsPathAliasCandidates } from "./tsconfig-paths.js";
import { uniqueStrings } from "./text-util.js";
export function extractLocalReferences(text, language, path) {
    const references = [];
    if (isTsJsPath(language, path))
        references.push(...extractTsJsReferences(text));
    if (isPythonPath(language, path))
        references.push(...extractPythonReferences(text));
    if (isCppPath(language, path))
        references.push(...extractCppReferences(text));
    return uniqueReferences(references);
}
export function resolveIndexedReference(db, fromPath, language, reference, pathFilter) {
    if (reference.kind === "include")
        return resolveIndexedInclude(db, fromPath, reference.specifier, pathFilter);
    return resolveIndexedImport(db, fromPath, language, reference.specifier, pathFilter);
}
function isTsJsPath(language, path) {
    return ["typescript", "javascript"].includes(language) || /\.[cm]?[jt]sx?$/.test(path.toLowerCase());
}
function isPythonPath(language, path) {
    return language === "python" || language === "py" || path.toLowerCase().endsWith(".py");
}
function isCppPath(language, path) {
    return ["c", "h", "cpp", "hpp"].includes(language) || /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/.test(path.toLowerCase());
}
function extractTsJsReferences(text) {
    const references = [];
    const patterns = [
        /\b(?:import|export)\s+(?:type\s+)?[\s\S]{0,500}?\bfrom\s*["']([^"']+)["']/g,
        /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
        /\brequire\(\s*["']([^"']+)["']\s*\)/g,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const specifier = cleanSpecifier(match[1] ?? "");
            if (isPotentialLocalTsJsSpecifier(specifier))
                references.push(withLines({ kind: "import", specifier }, text, match));
        }
    }
    return references;
}
function extractPythonReferences(text) {
    const references = [];
    for (const match of text.matchAll(/(?:^|\n)\s*from\s+(\.+)([A-Za-z_][\w.]*)?\s+import\s+([^\n#]+)/g)) {
        const dots = match[1] ?? "";
        const moduleName = (match[2] ?? "").replace(/\./g, "/");
        if (moduleName) {
            references.push(withLines({ kind: "import", specifier: pythonRelativeSpecifier(dots, moduleName) }, text, match));
            continue;
        }
        for (const imported of (match[3] ?? "").split(",")) {
            const name = imported.trim().split(/\s+as\s+/, 1)[0];
            if (/^[A-Za-z_]\w*$/.test(name))
                references.push(withLines({ kind: "import", specifier: pythonRelativeSpecifier(dots, name) }, text, match));
        }
    }
    return references;
}
function extractCppReferences(text) {
    return [...text.matchAll(/(?:^|\n)\s*#\s*include\s*"([^"]+)"/g)]
        .map((match) => withLines({ kind: "include", specifier: cleanSpecifier(match[1] ?? "") }, text, match))
        .filter((reference) => Boolean(reference.specifier) && !reference.specifier.startsWith("/"));
}
function withLines(reference, text, match) {
    const startIndex = match.index ?? 0;
    const lineStart = text.slice(0, startIndex).split(/\r?\n/).length;
    const lineEnd = lineStart + (match[0]?.match(/\r?\n/g)?.length ?? 0);
    return { ...reference, lineStart, lineEnd };
}
function pythonRelativeSpecifier(dots, moduleName) {
    const parentHops = Math.max(0, dots.length - 1);
    return `${"../".repeat(parentHops)}./${moduleName}`.replace(/^\.\.\/\.\//, "../").replace(/^\.\//, "./");
}
function cleanSpecifier(specifier) {
    return specifier.split(/[?#]/, 1)[0].trim();
}
function isPotentialLocalTsJsSpecifier(specifier) {
    return Boolean(specifier) && !specifier.startsWith("/") && !/^[a-z]+:/i.test(specifier);
}
function resolveIndexedImport(db, fromPath, language, specifier, pathFilter) {
    const normalized = normalizeLocalSpecifier(fromPath, specifier);
    const candidateBases = normalized ? [normalized] : isTsJsPath(language, fromPath) ? tsJsPathAliasCandidates(db, fromPath, specifier) : [];
    if (candidateBases.length === 0)
        return undefined;
    const candidates = uniqueStrings(candidateBases.flatMap((candidate) => isPythonPath(language, fromPath) ? pythonImportCandidates(candidate) : importCandidates(candidate)));
    for (const candidate of candidates) {
        const row = db.prepare("select path from files where path = ? and path like ? escape '\\' limit 1")
            .get(candidate, pathFilter);
        if (row)
            return row.path;
    }
    return undefined;
}
function resolveIndexedInclude(db, fromPath, specifier, pathFilter) {
    const direct = normalizeLocalSpecifier(fromPath, specifier.startsWith(".") ? specifier : `./${specifier}`);
    if (!direct)
        return undefined;
    for (const candidate of includeCandidates(direct)) {
        const row = db.prepare("select path from files where path = ? and path like ? escape '\\' limit 1")
            .get(candidate, pathFilter);
        if (row)
            return row.path;
    }
    return undefined;
}
function normalizeLocalSpecifier(fromPath, specifier) {
    if (!specifier.startsWith("."))
        return undefined;
    const baseDir = posix.dirname(fromPath);
    const normalized = posix.normalize(posix.join(baseDir, specifier));
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/"))
        return undefined;
    return normalized;
}
function importCandidates(path) {
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".py"];
    const hasExtension = /\.[^/.]+$/.test(path);
    return uniqueStrings([
        path,
        ...tsSourceCandidatesForJsSpecifier(path),
        ...(hasExtension ? [] : extensions.map((extension) => `${path}${extension}`)),
        ...(hasExtension ? [] : [`${path}/__init__.py`]),
        ...(hasExtension ? [] : extensions.map((extension) => `${path}/index${extension}`)),
    ]);
}
function tsSourceCandidatesForJsSpecifier(path) {
    if (path.endsWith(".js"))
        return [path.slice(0, -3) + ".ts", path.slice(0, -3) + ".tsx"];
    return [];
}
function pythonImportCandidates(path) {
    const hasExtension = /\.[^/.]+$/.test(path);
    return uniqueStrings([
        path,
        ...(hasExtension ? [] : [`${path}.py`, `${path}/__init__.py`]),
    ]);
}
function includeCandidates(path) {
    const hasExtension = /\.[^/.]+$/.test(path);
    const extensions = [".h", ".hh", ".hpp", ".hxx", ".c", ".cc", ".cpp", ".cxx"];
    return uniqueStrings([path, ...(hasExtension ? [] : extensions.map((extension) => `${path}${extension}`))]);
}
function uniqueReferences(references) {
    const seen = new Set();
    return references.filter((reference) => {
        const key = `${reference.kind}:${reference.specifier}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
