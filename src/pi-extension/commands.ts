import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { codeMapOperations, type CodeMapOperation } from "./operations.ts";
import { computeStatusText, STATUS_KEY } from "./status-bar.ts";

function registerCommandAdapter(pi: ExtensionAPI, operation: CodeMapOperation): void {
  pi.registerCommand(operation.commandName, {
    description: operation.commandDescription,
    handler: async (args, ctx) => {
      const params = operation.parseCommandArgs(args);
      const result = operation.execute(process.cwd(), params);
      const notification = operation.formatCommandResult(result);
      ctx.ui.notify(notification.message, notification.level);
      if (operation.toolName === "codemap_index") ctx.ui.setStatus(STATUS_KEY, computeStatusText(process.cwd()));
    },
  });
}

export function registerCodeMapCommands(pi: ExtensionAPI): void {
  for (const operation of codeMapOperations) registerCommandAdapter(pi, operation);
}
