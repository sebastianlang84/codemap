import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeRegExp } from "./text-util.js";
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
export function loadIgnoreRules(root) {
    return {
        gitignore: loadIgnoreFile(join(root, ".gitignore")),
        codemapignore: loadIgnoreFile(join(root, ".codemapignore")),
    };
}
function loadIgnoreFile(path) {
    if (!existsSync(path))
        return [];
    return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        // Keep `!` negation lines: they re-include a previously-ignored path (last matching rule wins).
        .filter((line) => line && !line.startsWith("#"));
}
export function shouldSkip(relPath, isDir, rules) {
    const parts = relPath.split("/");
    if (parts.some((part) => ignoredDirs.has(part)))
        return "ignored directory";
    const name = parts[parts.length - 1] ?? relPath;
    if (!isDir && ignoredFiles.some((rx) => rx.test(name)))
        return "binary/generated extension";
    if (!isDir && secretish.some((rx) => rx.test(name) || rx.test(relPath)))
        return "secret-like file";
    const gitignore = matchPatterns(relPath, name, rules.gitignore);
    if (gitignore)
        return ".gitignore";
    const codemapignore = matchPatterns(relPath, name, rules.codemapignore);
    if (codemapignore)
        return ".codemapignore";
    return undefined;
}
// Evaluate ignore rules with gitignore-style last-match-wins semantics: a later `!pattern` line can
// re-include a path that an earlier pattern ignored.
function matchPatterns(relPath, name, patterns) {
    let ignored = false;
    for (const raw of patterns) {
        const negated = raw.startsWith("!");
        const body = negated ? raw.slice(1) : raw;
        if (patternMatches(relPath, name, body))
            ignored = !negated;
    }
    return ignored;
}
function patternMatches(relPath, name, rawPattern) {
    const pattern = rawPattern.replace(/^\//, "");
    if (!pattern)
        return false;
    if (pattern.endsWith("/"))
        return relPath === pattern.slice(0, -1) || relPath.startsWith(pattern);
    if (/[*?]/.test(pattern)) {
        const rx = globToRegExp(pattern);
        return rx.test(relPath) || rx.test(name);
    }
    return relPath === pattern || relPath.startsWith(pattern + "/") || name === pattern;
}
// Translate a gitignore glob to an anchored RegExp. `*`/`?` do not cross `/` (unlike the previous
// `*`->`.*` translation); `**` matches across directories.
function globToRegExp(glob) {
    let source = "";
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        if (char === "*") {
            if (glob[i + 1] === "*") {
                source += ".*";
                i++;
            }
            else
                source += "[^/]*";
        }
        else if (char === "?") {
            source += "[^/]";
        }
        else {
            source += escapeRegExp(char);
        }
    }
    return new RegExp(`^${source}$`);
}
