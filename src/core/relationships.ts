import { posix } from "node:path";

import { openRepoDb } from "./db.ts";
import { fileRoles } from "./ranking.ts";

export type CodeMapContextReasonKind =
  | "target"
  | "search_result"
  | "import"
  | "reverse_import"
  | "include"
  | "reverse_include"
  | "implementation_pair"
  | "sibling_test"
  | "related_doc";

export interface CodeMapContextReason {
  kind: CodeMapContextReasonKind;
  label: string;
  sourcePath?: string;
  targetPath?: string;
  specifier?: string;
}

export interface RelatedPath {
  path: string;
  reasons: CodeMapContextReason[];
}

interface LocalReference {
  kind: "import" | "include";
  specifier: string;
}

export interface IndexedRelationships {
  imports: RelatedPath[];
  importers: RelatedPath[];
  implementationPairs: RelatedPath[];
}

export function findIndexedRelationships(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): IndexedRelationships {
  return {
    imports: importedLocalPaths(db, targetPath, pathFilter),
    importers: importingLocalPaths(db, targetPath, pathFilter),
    implementationPairs: implementationPairPaths(db, targetPath, pathFilter),
  };
}

export function mergeRelatedPaths(paths: RelatedPath[]): RelatedPath[] {
  const byPath = new Map<string, RelatedPath>();
  for (const item of paths) {
    const existing = byPath.get(item.path);
    if (!existing) {
      byPath.set(item.path, { path: item.path, reasons: dedupeReasons(item.reasons) });
      continue;
    }
    existing.reasons = dedupeReasons([...existing.reasons, ...item.reasons]);
  }
  return [...byPath.values()];
}

export function targetReason(path: string): CodeMapContextReason {
  return { kind: "target", label: "direct target file", targetPath: path };
}

export function searchResultReason(target: string): CodeMapContextReason {
  return { kind: "search_result", label: "fallback search result", specifier: target };
}

export function relatedTestReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "sibling_test", label: "name/path-related test", sourcePath: path, targetPath };
}

export function relatedDocReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "related_doc", label: "name/path-related documentation", sourcePath: path, targetPath };
}

export function isNoisyReadFirstPath(path: string, size = 0): boolean {
  const roles = fileRoles(path.toLowerCase(), size);
  return roles.some((role) => ["lockfile", "generated", "build_output", "minified", "large_json"].includes(role));
}

export function isNoisyIndexedPath(db: ReturnType<typeof openRepoDb>, path: string): boolean {
  const row = db.prepare("select size from files where path = ?").get(path) as { size: number } | undefined;
  return isNoisyReadFirstPath(path, row?.size ?? 0);
}

function importedLocalPaths(db: ReturnType<typeof openRepoDb>, fromPath: string, pathFilter: string): RelatedPath[] {
  const source = readIndexedSource(db, fromPath);
  if (!source) return [];
  const resolved = extractLocalReferences(source.text, source.language, source.path)
    .map((reference) => {
      const targetPath = resolveIndexedReference(db, fromPath, source.language, reference, pathFilter);
      if (!targetPath || targetPath === fromPath || isNoisyIndexedPath(db, targetPath)) return undefined;
      const related: RelatedPath = {
        path: targetPath,
        reasons: [{
          kind: reference.kind,
          label: reference.kind === "include" ? "quoted local include" : "local import",
          sourcePath: fromPath,
          targetPath,
          specifier: reference.specifier,
        }],
      };
      return related;
    })
    .filter((path): path is RelatedPath => Boolean(path));
  return mergeRelatedPaths(resolved).slice(0, 8);
}

function importingLocalPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  const rows = db.prepare("select path, size from files where path <> ? and path like ? escape '\\' order by path")
    .all(targetPath, pathFilter) as Array<{ path: string; size: number }>;
  const importers = rows
    .filter((row) => !isNoisyReadFirstPath(row.path, row.size))
    .flatMap((row) => indexedFileReferencesTarget(db, row.path, targetPath, pathFilter));
  return mergeRelatedPaths(sortRelatedByLocality(targetPath, importers)).slice(0, 8);
}

function indexedFileReferencesTarget(db: ReturnType<typeof openRepoDb>, fromPath: string, targetPath: string, pathFilter: string): RelatedPath[] {
  const source = readIndexedSource(db, fromPath);
  if (!source) return [];
  return extractLocalReferences(source.text, source.language, source.path)
    .map((reference) => {
      const resolved = resolveIndexedReference(db, fromPath, source.language, reference, pathFilter);
      if (resolved !== targetPath) return undefined;
      const related: RelatedPath = {
        path: fromPath,
        reasons: [{
          kind: reference.kind === "include" ? "reverse_include" : "reverse_import",
          label: reference.kind === "include" ? "file includes target" : "file imports target",
          sourcePath: fromPath,
          targetPath,
          specifier: reference.specifier,
        }],
      };
      return related;
    })
    .filter((path): path is RelatedPath => Boolean(path));
}

function implementationPairPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  const extension = targetPath.match(/\.[^.\/]+$/)?.[0]?.toLowerCase();
  const headerExtensions = new Set([".h", ".hh", ".hpp", ".hxx"]);
  const sourceExtensions = new Set([".c", ".cc", ".cpp", ".cxx"]);
  if (!extension || (!headerExtensions.has(extension) && !sourceExtensions.has(extension))) return [];

  const stem = targetPath.slice(0, -extension.length);
  const candidateExtensions = headerExtensions.has(extension) ? [...sourceExtensions] : [...headerExtensions];
  const rows = candidateExtensions
    .map((candidateExtension) => `${stem}${candidateExtension}`)
    .map((path) => db.prepare("select path, size from files where path = ? and path like ? escape '\\' limit 1").get(path, pathFilter) as { path: string; size: number } | undefined)
    .filter((row): row is { path: string; size: number } => Boolean(row && !isNoisyReadFirstPath(row.path, row.size)));

  return rows.map((row) => ({
    path: row.path,
    reasons: [{ kind: "implementation_pair", label: "matching header/source file", sourcePath: targetPath, targetPath: row.path }],
  }));
}

function readIndexedSource(db: ReturnType<typeof openRepoDb>, path: string): { path: string; language: string; text: string } | undefined {
  const rows = db.prepare(`
    select f.path, f.language, c.text from files f join chunks c on c.file_id = f.id
    where f.path = ?
    order by c.ordinal
  `).all(path) as Array<{ path: string; language: string; text: string }>;
  return rows.length > 0 ? { path: rows[0].path, language: rows[0].language, text: rows.map((row) => row.text).join("\n") } : undefined;
}

function extractLocalReferences(text: string, language: string, path: string): LocalReference[] {
  const references: LocalReference[] = [];
  if (isTsJsPath(language, path)) references.push(...extractTsJsReferences(text));
  if (isPythonPath(language, path)) references.push(...extractPythonReferences(text));
  if (isCppPath(language, path)) references.push(...extractCppReferences(text));
  return uniqueReferences(references);
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
      if (specifier.startsWith(".")) references.push({ kind: "import", specifier });
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
      references.push({ kind: "import", specifier: pythonRelativeSpecifier(dots, moduleName) });
      continue;
    }
    for (const imported of (match[3] ?? "").split(",")) {
      const name = imported.trim().split(/\s+as\s+/, 1)[0];
      if (/^[A-Za-z_]\w*$/.test(name)) references.push({ kind: "import", specifier: pythonRelativeSpecifier(dots, name) });
    }
  }
  return references;
}

function extractCppReferences(text: string): LocalReference[] {
  return [...text.matchAll(/(?:^|\n)\s*#\s*include\s*"([^"]+)"/g)]
    .map((match) => ({ kind: "include" as const, specifier: cleanSpecifier(match[1] ?? "") }))
    .filter((reference) => Boolean(reference.specifier) && !reference.specifier.startsWith("/"));
}

function pythonRelativeSpecifier(dots: string, moduleName: string): string {
  const parentHops = Math.max(0, dots.length - 1);
  return `${"../".repeat(parentHops)}./${moduleName}`.replace(/^\.\.\/\.\//, "../").replace(/^\.\//, "./");
}

function cleanSpecifier(specifier: string): string {
  return specifier.split(/[?#]/, 1)[0].trim();
}

function resolveIndexedReference(db: ReturnType<typeof openRepoDb>, fromPath: string, language: string, reference: LocalReference, pathFilter: string): string | undefined {
  if (reference.kind === "include") return resolveIndexedInclude(db, fromPath, reference.specifier, pathFilter);
  return resolveIndexedImport(db, fromPath, language, reference.specifier, pathFilter);
}

function resolveIndexedImport(db: ReturnType<typeof openRepoDb>, fromPath: string, language: string, specifier: string, pathFilter: string): string | undefined {
  const normalized = normalizeLocalSpecifier(fromPath, specifier);
  if (!normalized) return undefined;
  const candidates = isPythonPath(language, fromPath) ? pythonImportCandidates(normalized) : importCandidates(normalized);
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
    ...(hasExtension ? [] : extensions.map((extension) => `${path}${extension}`)),
    ...(hasExtension ? [] : [`${path}/__init__.py`]),
    ...extensions.map((extension) => `${path}/index${extension}`),
  ]);
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

function sortRelatedByLocality(base: string, paths: RelatedPath[]): RelatedPath[] {
  return paths.filter((path) => path.path !== base).sort((left, right) => localityScore(base, right.path) - localityScore(base, left.path) || left.path.localeCompare(right.path));
}

function localityScore(base: string, path: string): number {
  const baseDir = base.split("/").slice(0, -1);
  const pathDir = path.split("/").slice(0, -1);
  let shared = 0;
  while (shared < baseDir.length && shared < pathDir.length && baseDir[shared] === pathDir[shared]) shared++;
  const sameDir = baseDir.length === pathDir.length && shared === baseDir.length;
  const depthPenalty = Math.abs(baseDir.length - pathDir.length);
  return shared * 10 + (sameDir ? 5 : 0) - depthPenalty;
}

function dedupeReasons(reasons: CodeMapContextReason[]): CodeMapContextReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.kind}:${reason.sourcePath ?? ""}:${reason.targetPath ?? ""}:${reason.specifier ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
