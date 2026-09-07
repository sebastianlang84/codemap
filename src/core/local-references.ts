import { posix } from "node:path";

import { openRepoDb } from "./db.ts";
import { isRegexStart, regexEnd } from "./javascript-syntax.ts";
import { tsJsPathAliasCandidates } from "./tsconfig-paths.ts";
import { uniqueStrings } from "./text-util.ts";

export interface LocalReference {
  kind: "import" | "include";
  specifier: string;
  lineStart?: number;
  lineEnd?: number;
}

export function extractLocalReferences(text: string, language: string, path: string): LocalReference[] {
  const references: LocalReference[] = [];
  if (isTsJsPath(language, path)) references.push(...extractTsJsReferences(text));
  if (isPythonPath(language, path)) references.push(...extractPythonReferences(text));
  if (isCppPath(language, path)) references.push(...extractCppReferences(text));
  return uniqueReferences(references);
}

export function resolveIndexedReference(db: ReturnType<typeof openRepoDb>, fromPath: string, language: string, reference: LocalReference, pathFilter: string): string | undefined {
  if (reference.kind === "include") return resolveIndexedInclude(db, fromPath, reference.specifier, pathFilter);
  return resolveIndexedImport(db, fromPath, language, reference.specifier, pathFilter);
}

function isTsJsPath(language: string, path: string): boolean {
  return ["typescript", "javascript"].includes(language) || /\.[cm]?[jt]sx?$/.test(path.toLowerCase());
}

function isPythonPath(language: string, path: string): boolean {
  return language === "python" || language === "py" || path.toLowerCase().endsWith(".py");
}

function isCppPath(language: string, path: string): boolean {
  return ["c", "h", "cpp", "hpp"].includes(language) || /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/.test(path.toLowerCase());
}

function extractTsJsReferences(text: string): LocalReference[] {
  const references: LocalReference[] = [];
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
      if (isPotentialLocalTsJsSpecifier(specifier)) references.push(withLines({ kind: "import", specifier }, text, match));
    }
  }
  return references;
}

// Preserve offsets and quote boundaries while hiding non-executable text.
function tsJsReferenceCode(text: string): string {
  const code = text.split("");
  const hide = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (code[i] !== "\n" && code[i] !== "\r") code[i] = " ";
  };
  const modes: Array<{ template: boolean; braces: number }> = [{ template: false, braces: 0 }];
  for (let i = 0; i < text.length; i++) {
    const mode = modes[modes.length - 1];
    const char = text[i];
    if (mode.template) {
      if (char === "\\") { hide(i, Math.min(text.length, i + 2)); i++; }
      else if (char === "`") { modes.pop(); }
      else if (char === "$" && text[i + 1] === "{") {
        modes.push({ template: false, braces: 1 });
        i++;
      } else hide(i, i + 1);
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i + 2);
      const stop = end < 0 ? text.length : end;
      hide(i, stop);
      i = stop - 1;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      hide(i, stop);
      i = stop - 1;
    } else if (char === "'" || char === '"') {
      let end = i + 1;
      for (; end < text.length; end++) {
        if (text[end] === "\\") { end++; continue; }
        if (text[end] === char) break;
      }
      hide(i + 1, Math.min(end, text.length));
      i = end;
    } else if (char === "`") {
      modes.push({ template: true, braces: 0 });
    } else if (char === "/" && referenceRegexStart(code, i)) {
      const end = regexEnd(text, i);
      if (end > i) { hide(i, end + 1); i = end; }
    } else if (modes.length > 1) {
      if (char === "{") mode.braces++;
      else if (char === "}" && --mode.braces === 0) modes.pop();
    }
  }
  return code.join("");
}

function referenceRegexStart(code: string[], index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(code[previous])) previous--;
  const prefix = code.slice(Math.max(0, previous - 20), previous + 1).join("");
  return isRegexStart(prefix, prefix.length);
}

function extractPythonReferences(text: string): LocalReference[] {
  const references: LocalReference[] = [];
  const code = pythonReferenceCode(text);
  for (const match of code.matchAll(/^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+([^\n#]+)/gm)) {
    const dots = match[1] ?? "";
    const moduleName = (match[2] ?? "").replace(/\./g, "/");
    if (moduleName) {
      references.push(withLines({ kind: "import", specifier: dots ? pythonRelativeSpecifier(dots, moduleName) : moduleName }, text, match));
      continue;
    }
    if (!dots) continue;
    for (const imported of (match[3] ?? "").split(",")) {
      const name = imported.trim().split(/\s+as\s+/, 1)[0];
      if (/^[A-Za-z_]\w*$/.test(name)) references.push(withLines({ kind: "import", specifier: pythonRelativeSpecifier(dots, name) }, text, match));
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
function pythonReferenceCode(text: string): string {
  return text.replace(/#[^\n]*|("""|''')(?:\\[\s\S]|(?!\1)[\s\S])*(?:\1|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    value => value.replace(/[^\r\n]/g, " "));
}

function extractCppReferences(text: string): LocalReference[] {
  return [...text.matchAll(/(?:^|\n)\s*#\s*include\s*"([^"]+)"/g)]
    .map((match) => withLines({ kind: "include" as const, specifier: cleanSpecifier(match[1] ?? "") }, text, match))
    .filter((reference) => Boolean(reference.specifier) && !reference.specifier.startsWith("/"));
}

function withLines(reference: LocalReference, text: string, match: RegExpMatchArray): LocalReference {
  const startIndex = match.index ?? 0;
  const lineStart = text.slice(0, startIndex).split(/\r?\n/).length;
  const lineEnd = lineStart + (match[0]?.match(/\r?\n/g)?.length ?? 0);
  return { ...reference, lineStart, lineEnd };
}

function pythonRelativeSpecifier(dots: string, moduleName: string): string {
  const parentHops = Math.max(0, dots.length - 1);
  return `${"../".repeat(parentHops)}./${moduleName}`.replace(/^\.\.\/\.\//, "../").replace(/^\.\//, "./");
}

function cleanSpecifier(specifier: string): string {
  return specifier.split(/[?#]/, 1)[0].trim();
}

function isPotentialLocalTsJsSpecifier(specifier: string): boolean {
  return Boolean(specifier) && !specifier.startsWith("/") && !/^[a-z]+:/i.test(specifier);
}

function resolveIndexedImport(db: ReturnType<typeof openRepoDb>, fromPath: string, language: string, specifier: string, pathFilter: string): string | undefined {
  if (isPythonPath(language, fromPath) && !specifier.startsWith(".")) {
    if (!/^[A-Za-z_]\w*(?:\/[A-Za-z_]\w*)*$/.test(specifier)) return undefined;
    return uniqueIndexedCandidate(db, [specifier, `src/${specifier}`].flatMap(pythonImportCandidates), pathFilter);
  }
  const normalized = normalizeLocalSpecifier(fromPath, specifier);
  const candidateBases = normalized ? [normalized] : isTsJsPath(language, fromPath) ? tsJsPathAliasCandidates(db, fromPath, specifier) : [];
  if (candidateBases.length === 0) return undefined;
  const candidates = uniqueStrings(candidateBases.flatMap((candidate) => isPythonPath(language, fromPath) ? pythonImportCandidates(candidate) : importCandidates(candidate)));
  for (const candidate of candidates) {
    const row = db.prepare("select path from files where path = ? and path like ? escape '\\' limit 1")
      .get(candidate, pathFilter) as { path: string } | undefined;
    if (row) return row.path;
  }
  if (isTsJsPath(language, fromPath)) {
    if (candidates.some(candidate => db.prepare("select path from files where path = ?").get(candidate))) return undefined;
    const declarations = candidateBases.flatMap(candidate => candidate.endsWith(".js")
      ? [`${candidate.slice(0, -3)}.d.ts`]
      : /\.[^/.]+$/.test(candidate) ? [] : [`${candidate}.d.ts`, `${candidate}/index.d.ts`]);
    return uniqueIndexedCandidate(db, declarations, pathFilter);
  }
  return undefined;
}

function uniqueIndexedCandidate(db: ReturnType<typeof openRepoDb>, candidates: string[], pathFilter: string): string | undefined {
  const matches = uniqueStrings(candidates).filter(candidate => db.prepare("select path from files where path = ?").get(candidate));
  if (matches.length !== 1) return undefined;
  // Determine ambiguity before filtering so a narrow view cannot create false certainty.
  return db.prepare("select path from files where path = ? and path like ? escape '\\'").get(matches[0], pathFilter) ? matches[0] : undefined;
}

function resolveIndexedInclude(db: ReturnType<typeof openRepoDb>, fromPath: string, specifier: string, pathFilter: string): string | undefined {
  const direct = normalizeLocalSpecifier(fromPath, specifier.startsWith(".") ? specifier : `./${specifier}`);
  if (!direct) return undefined;
  for (const candidate of includeCandidates(direct)) {
    const row = db.prepare("select path from files where path = ? and path like ? escape '\\' limit 1")
      .get(candidate, pathFilter) as { path: string } | undefined;
    if (row) return row.path;
  }
  return undefined;
}

function normalizeLocalSpecifier(fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const baseDir = posix.dirname(fromPath);
  const normalized = posix.normalize(posix.join(baseDir, specifier));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/")) return undefined;
  return normalized;
}

function importCandidates(path: string): string[] {
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

function tsSourceCandidatesForJsSpecifier(path: string): string[] {
  if (path.endsWith(".js")) return [path.slice(0, -3) + ".ts", path.slice(0, -3) + ".tsx"];
  return [];
}

function pythonImportCandidates(path: string): string[] {
  const hasExtension = /\.[^/.]+$/.test(path);
  return uniqueStrings([
    path,
    ...(hasExtension ? [] : [`${path}.py`, `${path}/__init__.py`]),
  ]);
}

function includeCandidates(path: string): string[] {
  const hasExtension = /\.[^/.]+$/.test(path);
  const extensions = [".h", ".hh", ".hpp", ".hxx", ".c", ".cc", ".cpp", ".cxx"];
  return uniqueStrings([path, ...(hasExtension ? [] : extensions.map((extension) => `${path}${extension}`))]);
}

function uniqueReferences(references: LocalReference[]): LocalReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.kind}:${reference.specifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
