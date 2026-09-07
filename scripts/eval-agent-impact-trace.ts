import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { withoutClaudeAuth } from "./eval-agent-impact-auth.ts";

export function captureAgentImpactPatch(repo: string): string {
  const options = { cwd: repo, encoding: "utf8" as const, env: withoutClaudeAuth(process.env), maxBuffer: 64 * 1024 * 1024 };
  const tracked = spawnSync("git", ["diff", "--binary", "HEAD", "--"], options);
  if (tracked.error || tracked.status !== 0) throw tracked.error ?? new Error("Cannot capture tracked agent patch");
  const files = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options);
  if (files.error || files.status !== 0) throw files.error ?? new Error("Cannot list agent-created files");
  const parts = [tracked.stdout];
  for (const path of files.stdout.split("\0").filter(Boolean)) {
    const diff = spawnSync("git", ["diff", "--no-index", "--binary", "--", "/dev/null", path], options);
    if (diff.error || (diff.status !== 0 && diff.status !== 1)) throw diff.error ?? new Error("Cannot capture new agent file");
    parts.push(diff.stdout);
  }
  return parts.join("");
}

export function writeAgentImpactPatch(directory: string, runOrder: number, patch: string): void {
  if (!Number.isSafeInteger(runOrder) || runOrder < 1) throw new Error("Invalid patch run order");
  writeFileSync(join(directory, `run-${runOrder}-original.patch`), patch, { mode: 0o600, flag: "wx" });
}

// Raw provider output stays outside repositories and outside stable evidence.
export function createAgentImpactTraceDir(base: string, manifestSha256: string): string {
  let ancestor = resolve(base);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const git = spawnSync("git", ["-C", realpathSync(ancestor), "rev-parse", "--show-toplevel"], { encoding: "utf8", env: withoutClaudeAuth(process.env) });
  if (git.error) throw git.error;
  if (git.status === 0) throw new Error("Agent traces must be stored outside Git worktrees");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(base, "agent-impact-"));
  writeFileSync(join(directory, "manifest-sha256.txt"), `${manifestSha256}\n`, { mode: 0o600, flag: "wx" });
  return directory;
}

export function writeAgentImpactTrace(directory: string, trace: {
  taskId: string;
  mode: string;
  runOrder: number;
  agentDurationMs: number;
  indexDurationMs: number;
  status: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  setupDurationMs?: number;
  toolTimings?: unknown[];
  hostLoad?: { before: number[]; after: number[] };
}): void {
  if (!Number.isSafeInteger(trace.runOrder) || trace.runOrder < 1) throw new Error("Invalid trace run order");
  writeFileSync(join(directory, `run-${trace.runOrder}.json`), `${JSON.stringify(trace)}\n`, {
    mode: 0o600, flag: "wx",
  });
}
