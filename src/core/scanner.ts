import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, join, resolve, posix } from "node:path";
import { createScanPolicy, detectLanguage } from "./scan-policy.ts";

export { detectLanguage };

export interface ScannedFile {
  absPath: string;
  relPath: string;
  language: string;
  size: number;
  mtimeMs: number;
  hash: string;
  text: string;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: number;
  skippedReasons: Record<string, number>;
  warnings: string[];
  /**
   * True when the traversal did not fully complete — an unreadable directory, a per-file I/O error,
   * or an invalid pathPrefix. Callers must NOT treat unvisited indexed files as deleted in this case,
   * or a transient error would prune the index. See applyIndexUpdate's `allowDeletions`.
   */
  incomplete: boolean;
}

/** Prior indexed state used to skip re-reading unchanged files (keyed by repo-relative path). */
export interface KnownFileStat {
  mtimeMs: number;
  size: number;
  hash: string;
}

export function scanRepo(root: string, options: { pathPrefix?: string; knownFiles?: Map<string, KnownFileStat> } = {}): ScanResult {
  const policy = createScanPolicy(root);
  const prefix = normalizePathPrefix(options.pathPrefix);
  const known = options.knownFiles;
  const files: ScannedFile[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let incomplete = false;
  const skippedReasons: Record<string, number> = {};
  const skipOne = (reason: string) => {
    skipped++;
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // Can't list this directory (permissions, race). Skip its subtree but mark the scan incomplete
      // so its previously-indexed files are not mistaken for deletions.
      incomplete = true;
      warnings.push(`Unreadable directory ${dir}: ${String(error)}`);
      skipOne("unreadable directory");
      return;
    }
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      const relPath = relative(root, absPath).split("\\").join("/");
      if (entry.isSymbolicLink()) { skipOne("symlink"); continue; }
      const entrySkip = policy.entrySkipReason(relPath, entry.isDirectory());
      if (entrySkip) { skipOne(entrySkip); continue; }
      if (entry.isDirectory()) { walk(absPath); continue; }
      if (!entry.isFile()) { skipOne("not a regular file"); continue; }

      try {
        const stat = statSync(absPath);
        const filePolicy = policy.fileLanguageOrSkipReason(relPath, stat.size);
        if (filePolicy.skipReason) { skipOne(filePolicy.skipReason); continue; }

        const priorStat = known?.get(relPath);
        if (priorStat && priorStat.size === stat.size && Math.round(priorStat.mtimeMs) === Math.round(stat.mtimeMs)) {
          // Unchanged by mtime+size: reuse the stored hash and skip the read + sha256. applyIndexUpdate
          // compares hash+mtime and no-ops on these, so `text` is never consumed for them.
          files.push({ absPath, relPath, language: filePolicy.language ?? "", size: stat.size, mtimeMs: stat.mtimeMs, hash: priorStat.hash, text: "" });
          continue;
        }

        const buf = readFileSync(absPath);
        const contentSkip = policy.contentSkipReason(buf);
        if (contentSkip) { skipOne(contentSkip); continue; }
        files.push({
          absPath,
          relPath,
          language: filePolicy.language ?? "",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: createHash("sha256").update(buf).digest("hex"),
          text: buf.toString("utf8"),
        });
      } catch (error) {
        // A single file vanished mid-scan (ENOENT race) or became unreadable (EACCES). Skip it and
        // mark the scan incomplete so the deletion pass is suppressed for this run.
        incomplete = true;
        warnings.push(`Unreadable file ${relPath}: ${String(error)}`);
        skipOne("unreadable file");
      }
    }
  }

  try {
    if (prefix) {
      const repoRoot = resolve(root);
      const scopedRoot = resolve(root, prefix);
      if (scopedRoot !== repoRoot && !scopedRoot.startsWith(`${repoRoot}/`)) {
        incomplete = true;
        warnings.push(`Invalid pathPrefix outside repository: ${options.pathPrefix}`);
      } else {
        walk(scopedRoot);
      }
    } else {
      walk(root);
    }
  } catch (error) {
    incomplete = true;
    warnings.push(String(error));
  }
  return { files, skipped, skippedReasons, warnings, incomplete };
}

export function normalizePathPrefix(pathPrefix?: string): string {
  if (!pathPrefix) return "";
  const cleaned = pathPrefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const normalized = posix.normalize(cleaned).replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return "";
  return `${normalized}/`;
}
