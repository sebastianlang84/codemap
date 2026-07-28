import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadIgnoreRules, shouldSkip } from "./ignore.js";
const maxFileBytes = 1_000_000;
const textExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".sql", ".css", ".scss", ".html", ".py", ".go", ".rs", ".java", ".kt", ".sh", ".bash", ".zsh", ".rb", ".php", ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
]);
export function createScanPolicy(root) {
    const rules = loadIgnoreRules(root);
    const nestedWorktrees = new Set(listNestedWorktrees(root));
    return {
        entrySkipReason(relPath, isDir) {
            if (isDir && nestedWorktrees.has(relPath))
                return "nested git worktree";
            return shouldSkip(relPath, isDir, rules);
        },
        fileLanguageOrSkipReason(relPath, size) {
            if (size > maxFileBytes)
                return { skipReason: "too large" };
            const language = detectLanguage(relPath);
            return language ? { language } : { skipReason: "unsupported extension" };
        },
        contentSkipReason(buffer) {
            return buffer.includes(0) ? "binary content" : undefined;
        },
    };
}
/**
 * Repo-relative paths of git worktrees nested inside `root`. A nested worktree is a full second
 * checkout of the same tree, so indexing it duplicates every symbol and every doc — each search
 * returns both copies at near-identical scores, halving the information in a result list.
 *
 * `.git` inside a worktree is a *file* (a pointer to the main repository), so the `.git` entry in
 * ignore.ts's ignoredDirs never matches it.
 */
function listNestedWorktrees(root) {
    try {
        const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return parseNestedWorktrees(root, porcelain);
    }
    catch {
        // No git binary, not a repository, or an unsupported git version: index everything rather than
        // guessing, so a missing tool never silently drops files from the index.
        return [];
    }
}
/**
 * Extract nested-worktree paths from `git worktree list --porcelain` output.
 *
 * Detection deliberately goes through git rather than "`.git` is a file": a git *submodule* also has
 * a `.git` file, but a submodule is distinct code rather than a duplicate of this tree and must stay
 * indexed. The same holds for an unrelated repository that happens to sit inside the tree.
 */
export function parseNestedWorktrees(root, porcelain) {
    const canonicalRoot = canonicalPath(root);
    const nested = [];
    for (const line of porcelain.split(/\r?\n/)) {
        if (!line.startsWith("worktree "))
            continue;
        const worktree = canonicalPath(line.slice("worktree ".length).trim());
        // The tree being indexed is the target, never a foreign copy — this is the case where codemap is
        // invoked from inside a worktree and the main repository is the outsider (and lies outside root).
        if (worktree === canonicalRoot)
            continue;
        if (!worktree.startsWith(`${canonicalRoot}/`))
            continue;
        nested.push(relative(canonicalRoot, worktree).split("\\").join("/"));
    }
    return nested;
}
// Resolve symlinks on both sides before comparing: `git worktree list` reports real paths, while a
// root under a symlinked temp dir does not, and a textual prefix check would then never match.
function canonicalPath(path) {
    const absolute = resolve(path);
    try {
        return realpathSync(absolute);
    }
    catch {
        return absolute;
    }
}
export function detectLanguage(path) {
    const lower = path.toLowerCase();
    const ext = lower.match(/\.[^.]+$/)?.[0] ?? "";
    if (!textExtensions.has(ext))
        return "";
    if (ext === ".md" || ext === ".mdx")
        return "markdown";
    if ([".ts", ".tsx"].includes(ext))
        return "typescript";
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext))
        return "javascript";
    if (ext === ".json")
        return "json";
    if ([".yml", ".yaml"].includes(ext))
        return "yaml";
    if ([".c", ".h"].includes(ext))
        return "c";
    if ([".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"].includes(ext))
        return "cpp";
    return ext.slice(1);
}
