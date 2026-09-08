import { posix } from "node:path";
import { isRegexStart, regexEnd } from "./javascript-syntax.js";
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
    const code = tsJsReferenceCode(text);
    const patterns = [
        /\b(?:import|export)\s+(?:type\s+)?[\p{ID_Continue}$*{},\s"']{1,500}?\bfrom\s*["']([^"']+)["']/dgu,
        /\bimport\s*["']([^"']+)["']/dg,
        /\brequire\s*\(\s*["']([^"']+)["']\s*\)/dg,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/dg,
    ];
    for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
            const span = match.indices?.[1];
            const specifier = cleanSpecifier(span ? text.slice(...span) : "");
            if (isPotentialLocalTsJsSpecifier(specifier))
                references.push(withLines({ kind: "import", specifier }, text, match));
        }
    }
    return references;
}
// Preserve offsets and quote boundaries while hiding non-executable text.
function tsJsReferenceCode(text) {
    const code = text.split("");
    const hide = (start, end) => {
        for (let i = start; i < end; i++)
            if (code[i] !== "\n" && code[i] !== "\r")
                code[i] = " ";
    };
    const modes = [{ template: false, braces: 0 }];
    for (let i = 0; i < text.length; i++) {
        const mode = modes[modes.length - 1];
        const char = text[i];
        if (mode.template) {
            if (char === "\\") {
                hide(i, Math.min(text.length, i + 2));
                i++;
            }
            else if (char === "`") {
                modes.pop();
            }
            else if (char === "$" && text[i + 1] === "{") {
                modes.push({ template: false, braces: 1 });
                i++;
            }
            else
                hide(i, i + 1);
            continue;
        }
        if (char === "/" && text[i + 1] === "/") {
            const end = text.indexOf("\n", i + 2);
            const stop = end < 0 ? text.length : end;
            hide(i, stop);
            i = stop - 1;
        }
        else if (char === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            const stop = end < 0 ? text.length : end + 2;
            hide(i, stop);
            i = stop - 1;
        }
        else if (char === "'" || char === '"') {
            let end = i + 1;
            for (; end < text.length; end++) {
                if (text[end] === "\\") {
                    end++;
                    continue;
                }
                if (text[end] === char)
                    break;
            }
            hide(i + 1, Math.min(end, text.length));
            i = end;
        }
        else if (char === "`") {
            modes.push({ template: true, braces: 0 });
        }
        else if (char === "/" && referenceRegexStart(code, i)) {
            const end = regexEnd(text, i);
            if (end > i) {
                hide(i, end + 1);
                i = end;
            }
        }
        else if (modes.length > 1) {
            if (char === "{")
                mode.braces++;
            else if (char === "}" && --mode.braces === 0)
                modes.pop();
        }
    }
    return code.join("");
}
function referenceRegexStart(code, index) {
    let previous = index - 1;
    while (previous >= 0 && /\s/.test(code[previous]))
        previous--;
    const prefix = code.slice(Math.max(0, previous - 20), previous + 1).join("");
    return isRegexStart(prefix, prefix.length);
}
function extractPythonReferences(text) {
    const references = [];
    const code = pythonReferenceCode(text);
    for (const match of code.matchAll(/^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+([^\n#]+)/gm)) {
        const dots = match[1] ?? "";
        const moduleName = (match[2] ?? "").replace(/\./g, "/");
        if (moduleName) {
            references.push(withLines({ kind: "import", specifier: dots ? pythonRelativeSpecifier(dots, moduleName) : moduleName }, text, match));
            continue;
        }
        if (!dots)
            continue;
        for (const imported of (match[3] ?? "").split(",")) {
            const name = imported.trim().split(/\s+as\s+/, 1)[0];
            if (/^[A-Za-z_]\w*$/.test(name))
                references.push(withLines({ kind: "import", specifier: pythonRelativeSpecifier(dots, name) }, text, match));
        }
    }
    for (const match of code.matchAll(/^[ \t]*import[ \t]+([^\n;]+)/gm)) {
        for (const imported of match[1].split(",")) {
            const name = imported.trim().split(/\s+as\s+/, 1)[0];
            if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name)) {
                references.push(withLines({ kind: "import", specifier: name.replace(/\./g, "/") }, text, match));
            }
        }
    }
    return references;
}
// Strings and comments cannot introduce import statements; retain their source offsets.
function pythonReferenceCode(text) {
    return text.replace(/#[^\n]*|("""|''')(?:\\[\s\S]|(?!\1)[\s\S])*(?:\1|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, value => value.replace(/[^\r\n]/g, " "));
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
    if (isPythonPath(language, fromPath) && !specifier.startsWith(".")) {
        if (!/^[A-Za-z_]\w*(?:\/[A-Za-z_]\w*)*$/.test(specifier))
            return undefined;
        return uniqueIndexedCandidate(db, [specifier, `src/${specifier}`].flatMap(pythonImportCandidates), pathFilter);
    }
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
    if (isTsJsPath(language, fromPath)) {
        if (candidates.some(candidate => db.prepare("select path from files where path = ?").get(candidate)))
            return undefined;
        const declarations = candidateBases.flatMap(candidate => candidate.endsWith(".js")
            ? [`${candidate.slice(0, -3)}.d.ts`]
            : /\.[^/.]+$/.test(candidate) ? [] : [`${candidate}.d.ts`, `${candidate}/index.d.ts`]);
        return uniqueIndexedCandidate(db, declarations, pathFilter);
    }
    return undefined;
}
function uniqueIndexedCandidate(db, candidates, pathFilter) {
    const matches = uniqueStrings(candidates).filter(candidate => db.prepare("select path from files where path = ?").get(candidate));
    if (matches.length !== 1)
        return undefined;
    // Determine ambiguity before filtering so a narrow view cannot create false certainty.
    return db.prepare("select path from files where path = ? and path like ? escape '\\'").get(matches[0], pathFilter) ? matches[0] : undefined;
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
