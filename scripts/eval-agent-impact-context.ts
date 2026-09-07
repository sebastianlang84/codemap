import { createHash } from "node:crypto";
import { summarizeAgentImpact, type AgentImpactTask, type AgentImpactRunResult } from "./eval-agent-impact-lib.ts";

// Read only pinned base source. No reference patch or hidden-test text enters this prompt.
export function renderCuratedContext(task: AgentImpactTask, readBase: (path: string) => string): string {
  if (!task.sourceContext?.length) throw new Error("Missing curated context");
  let bytes = 0;
  const excerpts = task.sourceContext.map(range => {
    const lines = readBase(range.path).split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (range.end > lines.length) throw new Error("Context exceeds base source");
    const source = lines.slice(range.start - 1, range.end).join("\n") + "\n";
    if (createHash("sha256").update(source).digest("hex") !== range.sha256) throw new Error("Base context hash mismatch");
    bytes += Buffer.byteLength(source);
    return `${range.path}:${range.start}-${range.end}\n\`\`\`\n${source}\`\`\``;
  });
  if (bytes > 16 * 1024) throw new Error("Curated source exceeds 16 KiB");
  return "Selected existing source follows. It may be incomplete; inspect other code when needed.\n\n" + excerpts.join("\n\n");
}

export function summarizeContextDiagnostic(results: AgentImpactRunResult[], expectedTasks: number) {
  const compare = (control: "baseline" | "codemap", treatment: "codemap" | "curated") => {
    const rows = results.filter(row => row.mode === control || row.mode === treatment)
      .map(row => ({ ...row, mode: row.mode === control ? "baseline" as const : "codemap" as const }));
    const { treatmentAdoptionRate, crossArmContamination, ...summary } = summarizeAgentImpact(rows);
    return summary;
  };
  const completedTriplets = new Set(results.map(row => row.taskId));
  let validTriplets = 0;
  for (const taskId of completedTriplets) {
    if (["baseline", "codemap", "curated"].every(mode => results.some(row => row.taskId === taskId && row.mode === mode && !row.infrastructureError))) validTriplets++;
  }
  const contamination = results.filter(row => row.mode !== "codemap").some(row => Object.values(row.codemapCommands).some(count => count > 0));
  return {
    complete: validTriplets === expectedTasks && !contamination,
    validTriplets,
    contamination,
    codemapVsBaseline: compare("baseline", "codemap"),
    curatedVsBaseline: compare("baseline", "curated"),
    curatedVsCodemap: compare("codemap", "curated"),
    claimBoundary: "Retrospective selected-context diagnostic, not ideal-context upper bound or product generalization. Adoption is audited separately.",
  };
}
