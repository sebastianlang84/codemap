import { execFileSync } from "node:child_process";
export function readGitHead(root) {
    try {
        return execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    }
    catch {
        return null;
    }
}
export function readGitWorkingTreeStatus(root, pathPrefix = "") {
    const currentHead = readGitHead(root);
    const dirtyFiles = readGitDirtyFiles(root, pathPrefix);
    return { currentHead, dirty: dirtyFiles.length > 0, dirtyFiles };
}
function readGitDirtyFiles(root, pathPrefix) {
    try {
        const args = ["status", "--porcelain=v1", "-z"];
        if (pathPrefix)
            args.push("--", pathPrefix);
        const output = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return parsePorcelainStatus(output);
    }
    catch {
        return [];
    }
}
function parsePorcelainStatus(output) {
    const entries = output.split("\0");
    const files = [];
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!entry)
            continue;
        const code = entry.slice(0, 2);
        const path = entry.slice(3);
        if (!path)
            continue;
        files.push({ path, status: statusFromCode(code), code });
        if (code[0] === "R" || code[0] === "C")
            index++;
    }
    return files;
}
function statusFromCode(code) {
    if (code.includes("D"))
        return "deleted";
    if (code.includes("M"))
        return "modified";
    if (code.includes("A"))
        return "added";
    if (code.includes("R"))
        return "renamed";
    if (code.includes("C"))
        return "copied";
    if (code === "??")
        return "untracked";
    return "changed";
}
