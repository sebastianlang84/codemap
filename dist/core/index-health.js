import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readGitWorkingTreeStatus } from "./git-status.js";
import { readIndexedFileStats } from "./index-store.js";
import { createScanPolicy } from "./scan-policy.js";
import { scanRepo } from "./scanner.js";
import { escapeLike } from "./text-util.js";
export function readIndexStatusCounts(db, pathPrefix = "") {
    const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "";
    const files = pathPrefix
        ? db.prepare("select count(*) as n from files where path like ? escape '\\'").get(pathFilter).n
        : db.prepare("select count(*) as n from files").get().n;
    const chunks = pathPrefix
        ? db.prepare("select count(*) as n from chunks join files f on f.id = chunks.file_id where f.path like ? escape '\\'").get(pathFilter).n
        : db.prepare("select count(*) as n from chunks").get().n;
    const symbols = pathPrefix
        ? db.prepare("select count(*) as n from symbols join files f on f.id = symbols.file_id where f.path like ? escape '\\'").get(pathFilter).n
        : db.prepare("select count(*) as n from symbols").get().n;
    const lastIndexedAt = readPathAwareMeta(db, "last_indexed_at", pathPrefix);
    const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
    return { indexed: files > 0, files, chunks, symbols, lastIndexedAt, indexedHead };
}
export function cheapIndexHealth(db, root, pathPrefix = "") {
    const git = readGitWorkingTreeStatus(root, pathPrefix, "auto");
    const currentHead = git.currentHead;
    const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
    const headChanged = Boolean(indexedHead && currentHead && indexedHead !== currentHead);
    const warnings = [];
    let stale;
    if (currentHead === null && indexedHead !== null) {
        // HEAD became unreadable after the index was built against a real commit
        stale = true;
        warnings.push("Git HEAD unreadable — index may be stale.");
    }
    else if (headChanged) {
        stale = true;
        warnings.push("Git HEAD changed since last index.");
    }
    else if (currentHead !== null && indexedHead === null) {
        // Repo has commits but was never indexed with a HEAD baseline
        stale = true;
        warnings.push("No indexed HEAD baseline — index may be stale.");
    }
    else {
        stale = false;
    }
    const indexedFile = db.prepare("select mtime_ms as mtimeMs, size from files where path=?");
    const filePolicy = createScanPolicy(root, { discoverNestedWorktrees: false });
    let directoryPolicy;
    const relevantDirty = git.dirtyFiles.filter((file) => {
        const path = file.path.replace(/\/$/, "");
        const basename = path.slice(path.lastIndexOf("/") + 1);
        const ignoreRuleFile = basename === ".gitignore" || path === ".codemapignore";
        if (ignoreRuleFile && file.status === "deleted")
            return true;
        const indexed = indexedFile.get(path);
        if (file.status === "deleted")
            return indexed !== undefined;
        try {
            const stat = lstatSync(join(root, path));
            if (stat.isSymbolicLink())
                return false;
            if (indexed && indexed.size === stat.size && Math.round(indexed.mtimeMs) === Math.round(stat.mtimeMs))
                return false;
            if (filePolicy.entrySkipReason(path, stat.isDirectory()))
                return false;
            if (ignoreRuleFile)
                return true;
            if (stat.isDirectory()) {
                directoryPolicy ??= createScanPolicy(root);
                if (directoryPolicy.entrySkipReason(path, true))
                    return false;
                return directoryContainsIndexableFile(root, path, directoryPolicy);
            }
            const language = filePolicy.fileLanguageOrSkipReason(path, stat.size);
            if (!language.language)
                return false;
            return filePolicy.contentSkipReason(readFileSync(join(root, path))) === undefined;
        }
        catch {
            return indexed !== undefined;
        }
    });
    if (relevantDirty.length > 0) {
        stale = true;
        warnings.push(`Working tree changed in ${relevantDirty.length} indexable path${relevantDirty.length === 1 ? "" : "s"}; run full status for file-level counts.`);
    }
    return { stale, changed: 0, missing: 0, deleted: 0, currentHead, headChanged, dirty: git.dirty, dirtyFiles: git.dirtyFiles, warnings };
}
function directoryContainsIndexableFile(root, relDir, policy) {
    // Git's normal untracked mode collapses a whole tree to `dir/`. Inspect only that tree and stop at
    // the first indexable file. The bound keeps cheap health cheap on generated/untracked forests; if
    // it is reached (or the tree races us), report stale conservatively instead of hiding real drift.
    let remainingEntries = 2_048;
    const visit = (directory) => {
        let entries;
        try {
            entries = readdirSync(join(root, directory), { withFileTypes: true });
        }
        catch {
            return true;
        }
        for (const entry of entries) {
            remainingEntries--;
            if (remainingEntries < 0)
                return true;
            const path = `${directory}/${entry.name}`;
            if (entry.isSymbolicLink())
                continue;
            if (policy.entrySkipReason(path, entry.isDirectory()))
                continue;
            if (entry.isDirectory()) {
                if (visit(path))
                    return true;
                continue;
            }
            if (!entry.isFile())
                continue;
            if (entry.name === ".gitignore")
                return true;
            try {
                const stat = statSync(join(root, path));
                if (!policy.fileLanguageOrSkipReason(path, stat.size).language)
                    continue;
                if (policy.contentSkipReason(readFileSync(join(root, path))) === undefined)
                    return true;
            }
            catch {
                return true;
            }
        }
        return false;
    };
    return visit(relDir);
}
export function fullIndexHealth(db, root, pathPrefix = "") {
    // Reuse the indexer's mtime+size fastpath so unchanged files are not re-read and re-hashed on every
    // `context` / `status --health full` call: a single files read serves both the scanner fastpath and
    // the comparison map. `text` is never consumed here (only `hash`), so — unlike the incremental
    // indexer (indexer.ts) — no forced-reindex guard is needed. The `path = ?`/LIKE-prefix filter the
    // old query used is equivalent to `startsWith(pathPrefix)` (pathPrefix is a normalized dir prefix).
    const knownFiles = readIndexedFileStats(db);
    const scan = scanRepo(root, { pathPrefix, knownFiles });
    const indexed = new Map();
    for (const [path, stat] of knownFiles) {
        if (!pathPrefix || path.startsWith(pathPrefix))
            indexed.set(path, stat.hash);
    }
    const current = new Map(scan.files.map((file) => [file.relPath, file.hash]));
    let changed = 0;
    let missing = 0;
    let deleted = 0;
    for (const [path, hash] of current) {
        if (!indexed.has(path))
            missing++;
        else if (indexed.get(path) !== hash)
            changed++;
    }
    for (const path of indexed.keys())
        if (!current.has(path))
            deleted++;
    const fileDrift = changed > 0 || missing > 0 || deleted > 0;
    const warnings = [...scan.warnings];
    if (fileDrift)
        warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
    const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
    const git = readGitWorkingTreeStatus(root, pathPrefix);
    const headChanged = Boolean(indexedHead && git.currentHead && indexedHead !== git.currentHead);
    const dirtyFiles = git.dirtyFiles;
    const dirty = dirtyFiles.length > 0;
    // Only dirty paths the index actually covers can make it stale. Untracked content codemap never
    // indexes — a nested worktree, editor state, logs, all folded by git into a single `?? .claude/`
    // entry — otherwise marked every `context` call stale forever, since no `codemap index` run could
    // clear it. Files added or removed under such a directory still surface as changed/missing/deleted
    // through the hash comparison above, so no real drift is lost. `dirty`/`dirtyFiles` stay the raw
    // git view.
    const indexRelevantDirtyFiles = dirtyFiles.filter((file) => indexed.has(file.path) || current.has(file.path));
    const hasIndexedGitBaseline = Boolean(indexedHead && git.currentHead);
    const dirtyIndexedFiles = hasIndexedGitBaseline ? indexRelevantDirtyFiles.length : 0;
    if (headChanged)
        warnings.push("Git HEAD changed since last index.");
    if (dirtyIndexedFiles > 0)
        warnings.push(`Working tree dirty: ${dirtyIndexedFiles} indexed file${dirtyIndexedFiles === 1 ? "" : "s"}.`);
    const stale = fileDrift || headChanged || dirtyIndexedFiles > 0;
    return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, currentHead: git.currentHead, headChanged, dirty, dirtyFiles, warnings };
}
function readPathAwareMeta(db, baseKey, pathPrefix) {
    const scoped = pathPrefix ? readMeta(db, `${baseKey}:${pathPrefix}`) : null;
    return scoped ?? readMeta(db, baseKey);
}
function readMeta(db, key) {
    const value = db.prepare("select value from meta where key=?").get(key)?.value ?? null;
    return value || null;
}
