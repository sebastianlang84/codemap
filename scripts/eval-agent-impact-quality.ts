import { createHash } from "node:crypto";
import type { AgentImpactCommand, AgentImpactQualityCheck, AgentImpactQualityResult } from "./eval-agent-impact-lib.ts";

interface CheckOutput {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

/** Every check runs even after another fails; the same commands assess both agent arms. */
export function runQualityChecks(
  checks: AgentImpactQualityCheck[] | undefined,
  phase: "base" | "reference" | "agent",
  execute: (command: AgentImpactCommand) => CheckOutput,
): AgentImpactQualityResult[] {
  return (checks ?? []).map(check => {
    const result = execute(check.command);
    const output = result.stdout + "\n" + result.stderr;
    const expectedFailure = phase === "base" && check.baseline === "feature-failure";
    const passed = !result.timedOut && !result.error && result.status !== null
      && (expectedFailure ? result.status !== 0 && output.includes(check.expectedBaseFailure!) : result.status === 0);
    return { id: check.id, exitCode: result.status, timedOut: result.timedOut, passed,
      outputSha256: createHash("sha256").update(output).digest("hex") };
  });
}
