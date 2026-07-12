import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, join, resolve, posix } from "node:path";
import { createScanPolicy, detectLanguage } from "./scan-policy.js";
export { detectLanguage };
export function scanRepo(root, options = {}) {
    const policy = createScanPolicy(root);
    const prefix = normalizePathPrefix(options.pathPrefix);
    const known = options.knownFiles;
    const files = [];
    const warnings = [];
    let skipped = 0;
    let incomplete = false;
    const skippedReasons = {};
    const skipOne = (reason) => {
        skipped++;
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    };
    function walk(dir) {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch (error) {
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
            if (entry.isSymbolicLink()) {
                skipOne("symlink");
                continue;
            }
            const entrySkip = policy.entrySkipReason(relPath, entry.isDirectory());
            if (entrySkip) {
                skipOne(entrySkip);
                continue;
            }
            if (entry.isDirectory()) {
                walk(absPath);
                continue;
            }
            if (!entry.isFile()) {
                skipOne("not a regular file");
                continue;
            }
            try {
                const stat = statSync(absPath);
                const filePolicy = policy.fileLanguageOrSkipReason(relPath, stat.size);
                if (filePolicy.skipReason) {
                    skipOne(filePolicy.skipReason);
                    continue;
                }
                const priorStat = known?.get(relPath);
                if (priorStat && priorStat.size === stat.size && Math.round(priorStat.mtimeMs) === Math.round(stat.mtimeMs)) {
                    // Unchanged by mtime+size: reuse the stored hash and skip the read + sha256. applyIndexUpdate
                    // compares hash+mtime and no-ops on these, so `text` is never consumed for them.
                    files.push({ absPath, relPath, language: filePolicy.language ?? "", size: stat.size, mtimeMs: stat.mtimeMs, hash: priorStat.hash, text: "" });
                    continue;
                }
                const buf = readFileSync(absPath);
                const contentSkip = policy.contentSkipReason(buf);
                if (contentSkip) {
                    skipOne(contentSkip);
                    continue;
                }
                files.push({
                    absPath,
                    relPath,
                    language: filePolicy.language ?? "",
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                    hash: createHash("sha256").update(buf).digest("hex"),
                    text: buf.toString("utf8"),
                });
            }
            catch (error) {
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
            }
            else {
                walk(scopedRoot);
            }
        }
        else {
            walk(root);
        }
    }
    catch (error) {
        incomplete = true;
        warnings.push(String(error));
    }
    return { files, skipped, skippedReasons, warnings, incomplete };
}
export function normalizePathPrefix(pathPrefix) {
    if (!pathPrefix)
        return "";
    const cleaned = pathPrefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const normalized = posix.normalize(cleaned).replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized === ".")
        return "";
    return `${normalized}/`;
}
