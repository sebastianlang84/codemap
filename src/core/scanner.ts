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

/**
 * Mutable traversal state populated as scanRepoStream yields. Read AFTER the generator is fully
 * consumed: `incomplete` (deletion-guard input) and `scanned` are only final once iteration ends.
 */
export interface ScanState {
  skipped: number;
  skippedReasons: Record<string, number>;
  warnings: string[];
  incomplete: boolean;
  /** Count of files yielded so far. */
  scanned: number;
}

export function createScanState(): ScanState {
  return { skipped: 0, skippedReasons: {}, warnings: [], incomplete: false, scanned: 0 };
}

/**
 * Lazily yield scanned files, one at a time, mutating `state` as it goes. The indexer consumes this
 * directly so peak memory is one file's text, not the whole repo's — the previous eager array held
 * every changed file's contents at once. Callers that need the full set (index-health) use scanRepo.
 */
export function* scanRepoStream(
  root: string,
  options: { pathPrefix?: string; knownFiles?: Map<string, KnownFileStat> },
  state: ScanState,
): Generator<ScannedFile> {
  const policy = createScanPolicy(root);
  const prefix = normalizePathPrefix(options.pathPrefix);
  const known = options.knownFiles;
  const skipOne = (reason: string) => {
    state.skipped++;
    state.skippedReasons[reason] = (state.skippedReasons[reason] ?? 0) + 1;
  };

  function* walk(dir: string): Generator<ScannedFile> {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // Can't list this directory (permissions, race). Skip its subtree but mark the scan incomplete
      // so its previously-indexed files are not mistaken for deletions.
      state.incomplete = true;
      state.warnings.push(`Unreadable directory ${dir}: ${String(error)}`);
      skipOne("unreadable directory");
      return;
    }
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      const relPath = relative(root, absPath).split("\\").join("/");
      if (entry.isSymbolicLink()) { skipOne("symlink"); continue; }
      const entrySkip = policy.entrySkipReason(relPath, entry.isDirectory());
      if (entrySkip) { skipOne(entrySkip); continue; }
      if (entry.isDirectory()) { yield* walk(absPath); continue; }
      if (!entry.isFile()) { skipOne("not a regular file"); continue; }

      try {
        const stat = statSync(absPath);
        const filePolicy = policy.fileLanguageOrSkipReason(relPath, stat.size);
        if (filePolicy.skipReason) { skipOne(filePolicy.skipReason); continue; }

        const priorStat = known?.get(relPath);
        if (priorStat && priorStat.size === stat.size && Math.round(priorStat.mtimeMs) === Math.round(stat.mtimeMs)) {
          // Unchanged by mtime+size: reuse the stored hash and skip the read + sha256. applyIndexUpdate
          // compares hash+mtime and no-ops on these, so `text` is never consumed for them.
          state.scanned++;
          yield { absPath, relPath, language: filePolicy.language ?? "", size: stat.size, mtimeMs: stat.mtimeMs, hash: priorStat.hash, text: "" };
          continue;
        }

        const buf = readFileSync(absPath);
        const contentSkip = policy.contentSkipReason(buf);
        if (contentSkip) { skipOne(contentSkip); continue; }
        state.scanned++;
        yield {
          absPath,
          relPath,
          language: filePolicy.language ?? "",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: createHash("sha256").update(buf).digest("hex"),
          text: buf.toString("utf8"),
        };
      } catch (error) {
        // A single file vanished mid-scan (ENOENT race) or became unreadable (EACCES). Skip it and
        // mark the scan incomplete so the deletion pass is suppressed for this run.
        state.incomplete = true;
        state.warnings.push(`Unreadable file ${relPath}: ${String(error)}`);
        skipOne("unreadable file");
      }
    }
  }

  try {
    if (prefix) {
      const repoRoot = resolve(root);
      const scopedRoot = resolve(root, prefix);
      if (scopedRoot !== repoRoot && !scopedRoot.startsWith(`${repoRoot}/`)) {
        state.incomplete = true;
        state.warnings.push(`Invalid pathPrefix outside repository: ${options.pathPrefix}`);
      } else {
        yield* walk(scopedRoot);
      }
    } else {
      yield* walk(root);
    }
  } catch (error) {
    state.incomplete = true;
    state.warnings.push(String(error));
  }
}

/** Eager scan: materialize every file. Used by index-health, which needs the full current file set. */
export function scanRepo(root: string, options: { pathPrefix?: string; knownFiles?: Map<string, KnownFileStat> } = {}): ScanResult {
  const state = createScanState();
  const files = [...scanRepoStream(root, options, state)];
  return { files, skipped: state.skipped, skippedReasons: state.skippedReasons, warnings: state.warnings, incomplete: state.incomplete };
}

export function normalizePathPrefix(pathPrefix?: string): string {
  if (!pathPrefix) return "";
  const cleaned = pathPrefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const normalized = posix.normalize(cleaned).replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return "";
  return `${normalized}/`;
}
