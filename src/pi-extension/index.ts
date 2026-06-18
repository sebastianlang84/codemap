import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { status } from "../core/indexer.ts";
import { registerCodeMapTools } from "./tools.ts";
import { registerCodeMapCommands } from "./commands.ts";

const STATUS_KEY = "codemap";
const STATUS_OK_TEXT = "CodeMap ✓";
const STATUS_NOT_INDEXED_TEXT = "CodeMap ✗";
const STATUS_ERROR_TEXT = "CodeMap ✗";

function isSearchCommand(command: string): boolean {
  const segments = command.split(/[|;&]/);
  return segments.some((seg) => {
    const tokens = seg.trim().split(/\s+/);
    const cmd = tokens[0]?.replace(/^.*\//, ""); // basename
    if (cmd === "rg" || cmd === "grep" || cmd === "find") return true;
    // git grep
    if (cmd === "git") {
      const sub = tokens.find((t, i) => i > 0 && !t.startsWith("-"));
      return sub === "grep";
    }
    return false;
  });
}

export default function codeMapExtension(pi: ExtensionAPI): void {
  const blockedOnce = new Set<string>();
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      const currentStatus = status(process.cwd(), { health: "cheap" });
      ctx.ui.setStatus(STATUS_KEY, currentStatus.readiness === "ready" ? STATUS_OK_TEXT : STATUS_NOT_INDEXED_TEXT);
    } catch {
      ctx.ui.setStatus(STATUS_KEY, STATUS_ERROR_TEXT);
    }
  });

  registerCodeMapTools(pi);
  registerCodeMapCommands(pi);

  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!isSearchCommand(event.input.command)) return;

    // Check if repo is indexed
    let repoStatus: ReturnType<typeof status>;
    try {
      repoStatus = status(ctx.cwd, { health: "cheap" });
    } catch {
      return;
    }
    if (repoStatus.readiness !== "ready") return;

    // Block-once-then-yield
    const key = event.input.command.trim().split(/\s+/).slice(0, 2).join(" ");
    if (blockedOnce.has(key)) return; // second time: let through
    blockedOnce.add(key);

    return {
      block: true,
      reason:
        "This repo is indexed with CodeMap. Use codemap_search or codemap_context instead of bash grep/rg/find for navigation queries.",
    };
  });

  pi.on("session_shutdown", () => {
    blockedOnce.clear();
  });
}
