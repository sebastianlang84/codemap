import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { escapeRegExp } from "./text-util.ts";

const ignoredDirs = new Set([
  ".git", "node_modules", "dist", "build", "target", ".next", "coverage", "vendor", ".turbo", ".cache", ".idea", ".vscode", ".pi/npm", ".pi/git",
  ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", "site-packages", ".gradle", ".parcel-cache",
]);
const ignoredFiles = [
  /\.min\.js$/i,
  /\.png$/i,
  /\.jpe?g$/i,
  /\.gif$/i,
  /\.webp$/i,
  /\.pdf$/i,
  /\.zip$/i,
  /\.sqlite(?:-wal|-shm)?$/i,
];
const secretish = [/^\.env($|\.)/, /secret/i, /private[-_]?key/i];

export interface IgnoreRules {
  gitignore: string[];
  codemapignore: string[];
  root?: string;
  nestedGitignore?: Map<string, string[]>;
}

export function loadIgnoreRules(root: string): IgnoreRules {
  return {
    gitignore: loadIgnoreFile(join(root, ".gitignore")),
    codemapignore: loadIgnoreFile(join(root, ".codemapignore")),
    root,
    nestedGitignore: new Map(),
  };
}

function loadIgnoreFile(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Keep `!` negation lines: they re-include a previously-ignored path (last matching rule wins).
    .filter((line) => line && !line.startsWith("#"));
}

export function shouldSkip(relPath: string, isDir: boolean, rules: IgnoreRules): string | undefined {
  const parts = relPath.split("/");
  if (parts.some((part) => ignoredDirs.has(part))) return "ignored directory";
  const name = parts[parts.length - 1] ?? relPath;
  if (!isDir && ignoredFiles.some((rx) => rx.test(name))) return "binary/generated extension";
  if (!isDir && secretish.some((rx) => rx.test(name) || rx.test(relPath))) return "secret-like file";

  const gitignore = matchGitignoreFiles(relPath, name, rules);
  if (gitignore) return ".gitignore";
  const codemapignore = matchPatterns(relPath, name, rules.codemapignore);
  if (codemapignore) return ".codemapignore";
  return undefined;
}

function matchGitignoreFiles(relPath: string, name: string, rules: IgnoreRules): boolean {
  let ignored = matchPatterns(relPath, name, rules.gitignore);
  if (!rules.root || !rules.nestedGitignore) return ignored;

  const parent = dirname(relPath).replace(/^\.$/, "");
  if (!parent) return ignored;
  const parts = parent.split("/");
  for (let index = 0; index < parts.length; index++) {
    const base = parts.slice(0, index + 1).join("/");
    let patterns = rules.nestedGitignore.get(base);
    if (!patterns) {
      patterns = loadIgnoreFile(join(rules.root, base, ".gitignore"));
      rules.nestedGitignore.set(base, patterns);
    }
    if (patterns.length === 0) continue;
    const localPath = relPath.slice(base.length + 1);
    const localName = localPath.slice(localPath.lastIndexOf("/") + 1);
    ignored = matchPatterns(localPath, localName, patterns, ignored);
  }
  return ignored;
}

// Evaluate ignore rules with gitignore-style last-match-wins semantics: a later `!pattern` line can
// re-include a path that an earlier pattern ignored.
function matchPatterns(relPath: string, name: string, patterns: string[], initial = false): boolean {
  let ignored = initial;
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    const body = negated ? raw.slice(1) : raw;
    if (patternMatches(relPath, name, body)) ignored = !negated;
  }
  return ignored;
}

function patternMatches(relPath: string, name: string, rawPattern: string): boolean {
  let pattern = rawPattern.replace(/^\//, "");
  if (!pattern) return false;
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const candidates = directoryOnly ? pathPrefixes(relPath) : [relPath];
  if (/[*?]/.test(pattern)) {
    const rx = globToRegExp(pattern);
    if (candidates.some((candidate) => rx.test(candidate))) return true;
    if (!pattern.includes("/")) {
      const names = directoryOnly
        ? candidates.map((candidate) => candidate.slice(candidate.lastIndexOf("/") + 1))
        : [name];
      return names.some((candidate) => rx.test(candidate));
    }
    return false;
  }
  if (directoryOnly) {
    return pattern.includes("/")
      ? candidates.includes(pattern)
      : relPath.split("/").includes(pattern);
  }
  return relPath === pattern || relPath.startsWith(pattern + "/") || name === pattern;
}

function pathPrefixes(relPath: string): string[] {
  const parts = relPath.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Translate a gitignore glob to an anchored RegExp. `*`/`?` do not cross `/` (unlike the previous
// `*`->`.*` translation); `**` matches across directories.
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*" && glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      }
      else if (glob[i + 1] === "*") { source += ".*"; i++; }
      else source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}
