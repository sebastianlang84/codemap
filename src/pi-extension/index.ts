import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";
import { codeMapNavigationNudge } from "../application/navigation-nudge.ts";
import { registerCodeMapTools } from "./tools.ts";
import { registerCodeMapCommands } from "./commands.ts";
import { computeStatusText, STATUS_KEY } from "./status-bar.ts";

export default function codeMapExtension(pi: ExtensionAPI): void {
  const nudgedRepoRoots = new Set<string>();
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, computeStatusText(ctx.cwd));
  });

  registerCodeMapTools(pi);
  registerCodeMapCommands(pi);

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!isBashToolResult(event)) return;
    const command = typeof event.input.command === "string" ? event.input.command : "";
    const nudge = codeMapNavigationNudge(command, { cwd: ctx.cwd, surface: "pi" });
    if (!nudge.nudge || !nudge.root || !nudge.hint) return;
    if (nudgedRepoRoots.has(nudge.root)) return;
    nudgedRepoRoots.add(nudge.root);

    return {
      content: [...event.content, { type: "text" as const, text: nudge.hint }],
    };
  });

  pi.on("session_shutdown", () => {
    nudgedRepoRoots.clear();
  });
}
