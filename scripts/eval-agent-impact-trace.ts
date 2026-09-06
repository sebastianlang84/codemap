import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { withoutClaudeAuth } from "./eval-agent-impact-auth.ts";

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
}): void {
  if (!Number.isSafeInteger(trace.runOrder) || trace.runOrder < 1) throw new Error("Invalid trace run order");
  writeFileSync(join(directory, `run-${trace.runOrder}.json`), `${JSON.stringify(trace)}\n`, {
    mode: 0o600, flag: "wx",
  });
}
