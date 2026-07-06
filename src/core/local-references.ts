import { posix } from "node:path";

import { openRepoDb } from "./db.ts";
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
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\s\S]{0,500}?\bfrom\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = cleanSpecifier(match[1] ?? "");
      if (isPotentialLocalTsJsSpecifier(specifier)) references.push(withLines({ kind: "import", specifier }, text, match));
    }
  }
  return references;
}

function extractPythonReferences(text: string): LocalReference[] {
  const references: LocalReference[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*from\s+(\.+)([A-Za-z_][\w.]*)?\s+import\s+([^\n#]+)/g)) {
    const dots = match[1] ?? "";
    const moduleName = (match[2] ?? "").replace(/\./g, "/");
    if (moduleName) {
      references.push(withLines({ kind: "import", specifier: pythonRelativeSpecifier(dots, moduleName) }, text, match));
      continue;
    }
    for (const imported of (match[3] ?? "").split(",")) {
      const name = imported.trim().split(/\s+as\s+/, 1)[0];
      if (/^[A-Za-z_]\w*$/.test(name)) references.push(withLines({ kind: "import", specifier: pythonRelativeSpecifier(dots, name) }, text, match));
    }
  }
  return references;
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
  const normalized = normalizeLocalSpecifier(fromPath, specifier);
  const candidateBases = normalized ? [normalized] : isTsJsPath(language, fromPath) ? tsJsPathAliasCandidates(db, fromPath, specifier) : [];
  if (candidateBases.length === 0) return undefined;
  const candidates = uniqueStrings(candidateBases.flatMap((candidate) => isPythonPath(language, fromPath) ? pythonImportCandidates(candidate) : importCandidates(candidate)));
  for (const candidate of candidates) {
    const row = db.prepare("select path from files where path = ? and path like ? escape '\\' limit 1")
      .get(candidate, pathFilter) as { path: string } | undefined;
    if (row) return row.path;
  }
  return undefined;
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
