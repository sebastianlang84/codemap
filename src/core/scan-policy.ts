import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadIgnoreRules, shouldSkip } from "./ignore.ts";

const maxFileBytes = 1_000_000;
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".sql", ".css", ".scss", ".html", ".py", ".go", ".rs", ".java", ".kt", ".sh", ".bash", ".zsh", ".rb", ".php", ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
]);

export interface ScanPolicy {
  entrySkipReason(relPath: string, isDir: boolean): string | undefined;
  fileLanguageOrSkipReason(relPath: string, size: number): { language?: string; skipReason?: string };
  contentSkipReason(buffer: Buffer): string | undefined;
}

export function createScanPolicy(root: string, options: { discoverNestedWorktrees?: boolean } = {}): ScanPolicy {
  const rules = loadIgnoreRules(root);
  const nestedWorktrees = options.discoverNestedWorktrees === false ? new Set<string>() : new Set(listNestedWorktrees(root));
  return {
    entrySkipReason(relPath, isDir) {
      if (isDir && nestedWorktrees.has(relPath)) return "nested git worktree";
      return shouldSkip(relPath, isDir, rules);
    },
    fileLanguageOrSkipReason(relPath, size) {
      if (size > maxFileBytes) return { skipReason: "too large" };
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
function listNestedWorktrees(root: string): string[] {
  try {
    const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseNestedWorktrees(root, porcelain);
  } catch {
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
export function parseNestedWorktrees(root: string, porcelain: string): string[] {
  const canonicalRoot = canonicalPath(root);
  const nested: string[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const worktree = canonicalPath(line.slice("worktree ".length).trim());
    // The tree being indexed is the target, never a foreign copy — this is the case where codemap is
    // invoked from inside a worktree and the main repository is the outsider (and lies outside root).
    if (worktree === canonicalRoot) continue;
    if (!worktree.startsWith(`${canonicalRoot}/`)) continue;
    nested.push(toPosix(relative(canonicalRoot, worktree)));
  }
  return nested;
}

// Resolve symlinks on both sides before comparing: `git worktree list` reports real paths, while a
// root under a symlinked temp dir does not, and a textual prefix check would then never match.
//
// Two Windows-only details, each of which alone made the prefix test below unmatchable — so nested
// worktrees were never detected on Windows and every one of them stayed indexed as a second copy:
//
//   - `realpathSync.native` is used ahead of the JS implementation because only the native one
//     expands 8.3 short names (`C:\Users\SEBAST~1\...`, which `os.tmpdir()` returns). `git worktree
//     list` always reports the long form, so the two sides disagreed on a short-named root.
//   - The result is normalised to forward slashes, because `resolve`/`realpathSync` return
//     backslashes on Windows while the prefix test joins with `/`.
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  return toPosix(realpath(absolute));
}

function realpath(absolute: string): string {
  try {
    return realpathSync.native(absolute);
  } catch {
    // A path that does not exist (or an unreadable parent): fall back to the JS implementation, then
    // to the unresolved path, rather than dropping the entry.
    try {
      return realpathSync(absolute);
    } catch {
      return absolute;
    }
  }
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

export function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.match(/\.[^.]+$/)?.[0] ?? "";
  if (!textExtensions.has(ext)) return "";
  if (ext === ".md" || ext === ".mdx") return "markdown";
  if ([".ts", ".tsx"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".json") return "json";
  if ([".yml", ".yaml"].includes(ext)) return "yaml";
  if ([".c", ".h"].includes(ext)) return "c";
  if ([".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"].includes(ext)) return "cpp";
  return ext.slice(1);
}
