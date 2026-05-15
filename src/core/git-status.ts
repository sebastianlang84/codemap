import { execFileSync } from "node:child_process";

export interface GitDirtyFile {
  path: string;
  status: string;
  code: string;
}

export interface GitWorkingTreeStatus {
  currentHead: string | null;
  dirty: boolean;
  dirtyFiles: GitDirtyFile[];
}

export function readGitHead(root: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function readGitWorkingTreeStatus(root: string, pathPrefix = ""): GitWorkingTreeStatus {
  const currentHead = readGitHead(root);
  const dirtyFiles = readGitDirtyFiles(root, pathPrefix);
  return { currentHead, dirty: dirtyFiles.length > 0, dirtyFiles };
}

function readGitDirtyFiles(root: string, pathPrefix: string): GitDirtyFile[] {
  try {
    const args = ["status", "--porcelain=v1", "-z"];
    if (pathPrefix) args.push("--", pathPrefix);
    const output = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return parsePorcelainStatus(output);
  } catch {
    return [];
  }
}

function parsePorcelainStatus(output: string): GitDirtyFile[] {
  const entries = output.split("\0");
  const files: GitDirtyFile[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!path) continue;
    files.push({ path, status: statusFromCode(code), code });
    if (code[0] === "R" || code[0] === "C") index++;
  }
  return files;
}

function statusFromCode(code: string): string {
  if (code.includes("D")) return "deleted";
  if (code.includes("M")) return "modified";
  if (code.includes("A")) return "added";
  if (code.includes("R")) return "renamed";
  if (code.includes("C")) return "copied";
  if (code === "??") return "untracked";
  return "changed";
}
