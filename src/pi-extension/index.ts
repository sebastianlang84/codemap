import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeMapTools } from "./tools.ts";
import { registerCodeMapCommands } from "./commands.ts";

const STATUS_KEY = "codemap";
const STATUS_OK_TEXT = "CodeMap ✓";
const STATUS_ERROR_TEXT = "CodeMap ✗";

export default function codeMapExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setStatus(STATUS_KEY, STATUS_OK_TEXT);
    } catch {
      ctx.ui.setStatus(STATUS_KEY, STATUS_ERROR_TEXT);
    }
  });

  registerCodeMapTools(pi);
  registerCodeMapCommands(pi);
}
