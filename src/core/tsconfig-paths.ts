import { posix } from "node:path";

import { openRepoDb } from "./db.ts";

interface PathMapping {
  configDir: string;
  baseDir: string;
  pattern: string;
  prefix: string;
  suffix: string;
  targets: string[];
}

const aliasCache = new WeakMap<ReturnType<typeof openRepoDb>, PathMapping[]>();

export function tsJsPathAliasCandidates(db: ReturnType<typeof openRepoDb>, fromPath: string, specifier: string): string[] {
  if (specifier.startsWith(".") || specifier.startsWith("/") || /^[a-z]+:/i.test(specifier)) return [];
  const matches = pathMappings(db)
    .filter((mapping) => isWithinConfigDir(fromPath, mapping.configDir))
    .map((mapping) => ({ mapping, wildcard: matchPattern(specifier, mapping) }))
    .filter((match): match is { mapping: PathMapping; wildcard: string } => match.wildcard !== undefined);
  const nearestConfigLength = Math.max(-1, ...matches.map((match) => match.mapping.configDir.length));
  const candidates: string[] = [];
  for (const { mapping, wildcard } of matches
    .filter((match) => match.mapping.configDir.length === nearestConfigLength)
    .sort((left, right) => right.mapping.prefix.length - left.mapping.prefix.length || left.mapping.pattern.localeCompare(right.mapping.pattern))) {
    for (const target of mapping.targets) {
      const mapped = applyTarget(mapping, target, wildcard);
      if (mapped) candidates.push(mapped);
    }
  }
  return [...new Set(candidates)];
}

function pathMappings(db: ReturnType<typeof openRepoDb>): PathMapping[] {
  const cached = aliasCache.get(db);
  if (cached) return cached;
  const configs = readIndexedConfigs(db);
  const mappings = configs.flatMap((config) => parseConfigMappings(config.path, config.text));
  aliasCache.set(db, mappings);
  return mappings;
}

function readIndexedConfigs(db: ReturnType<typeof openRepoDb>): Array<{ path: string; text: string }> {
  const rows = db.prepare(`
    select f.path, c.start_line as startLine, c.end_line as endLine, c.text
    from files f join chunks c on c.file_id = f.id
    where f.path like '%tsconfig.json' or f.path like '%jsconfig.json'
    order by f.path, c.ordinal
  `).all() as Array<{ path: string; startLine: number; endLine: number; text: string }>;
  const byPath = new Map<string, Array<{ startLine: number; endLine: number; text: string }>>();
  for (const row of rows) {
    const chunks = byPath.get(row.path) ?? [];
    chunks.push({ startLine: row.startLine, endLine: row.endLine, text: row.text });
    byPath.set(row.path, chunks);
  }
  return [...byPath.entries()]
    .filter(([path]) => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(path))
    .map(([path, chunks]) => ({ path, text: reconstructChunkedText(chunks) }));
}

function reconstructChunkedText(chunks: Array<{ startLine: number; endLine: number; text: string }>): string {
  const lines: string[] = [];
  for (const chunk of chunks) {
    const chunkLines = chunk.text.split(/\r?\n/);
    for (let index = 0; index < chunkLines.length; index++) {
      const lineNumber = chunk.startLine + index;
      if (lineNumber > chunk.endLine) break;
      lines[lineNumber - 1] ??= chunkLines[index];
    }
  }
  return lines.map((line) => line ?? "").join("\n");
}

function parseConfigMappings(configPath: string, text: string): PathMapping[] {
  const parsed = parseJsonObject(text);
  const compilerOptions = asObject(parsed?.compilerOptions);
  const paths = asObject(compilerOptions?.paths);
  if (!paths) return [];
  const configDir = directoryName(configPath);
  const baseUrl = typeof compilerOptions?.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  const baseDir = normalizeRepoPath(posix.join(configDir, baseUrl)) ?? configDir;
  const mappings: PathMapping[] = [];
  for (const [pattern, rawTargets] of Object.entries(paths)) {
    if (typeof pattern !== "string") continue;
    const targets = Array.isArray(rawTargets) ? rawTargets.filter((target): target is string => typeof target === "string") : [];
    if (targets.length === 0) continue;
    const split = splitPattern(pattern);
    mappings.push({ configDir, baseDir, pattern, prefix: split.prefix, suffix: split.suffix, targets });
  }
  return mappings;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
      index++;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function splitPattern(pattern: string): { prefix: string; suffix: string } {
  const star = pattern.indexOf("*");
  if (star === -1) return { prefix: pattern, suffix: "" };
  return { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1) };
}

function matchPattern(specifier: string, mapping: PathMapping): string | undefined {
  if (!mapping.pattern.includes("*")) return specifier === mapping.pattern ? "" : undefined;
  if (!specifier.startsWith(mapping.prefix) || !specifier.endsWith(mapping.suffix)) return undefined;
  return specifier.slice(mapping.prefix.length, specifier.length - mapping.suffix.length);
}

function applyTarget(mapping: PathMapping, target: string, wildcard: string): string | undefined {
  const targetPath = target.includes("*") ? target.replace("*", wildcard) : target;
  return normalizeRepoPath(posix.join(mapping.baseDir, targetPath));
}

function normalizeRepoPath(path: string): string | undefined {
  const normalized = posix.normalize(path).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/")) return undefined;
  return normalized;
}

function directoryName(path: string): string {
  const dir = posix.dirname(path);
  return dir === "." ? "" : dir;
}

function isWithinConfigDir(path: string, configDir: string): boolean {
  return !configDir || path === configDir || path.startsWith(`${configDir}/`);
}
