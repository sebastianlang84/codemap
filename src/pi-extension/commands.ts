import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodebaseWithDiagnostics } from "../core/search.ts";
import { codebaseContext } from "../core/context.ts";

export function registerCodeSearchCommands(pi: ExtensionAPI): void {
  pi.registerCommand("codebase-status", {
    description: "Show code-search approval/index status; pass --full for stale diagnostics",
    handler: async (args, ctx) => ctx.ui.notify(JSON.stringify(status(process.cwd(), { health: args.includes("--full") ? "full" : "cheap" }), null, 2), "info"),
  });

  pi.registerCommand("codebase-index", {
    description: "Index current repo; pass --approve-repo the first time",
    handler: async (args, ctx) => {
      const result = indexRepo({ cwd: process.cwd(), approve: args.includes("--approve-repo") });
      ctx.ui.notify(`Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped)`, "info");
    },
  });

  pi.registerCommand("codebase-search", {
    description: "Search indexed repo: /codebase-search <query>",
    handler: async (args, ctx) => {
      const result = searchCodebaseWithDiagnostics({ query: args, cwd: process.cwd(), limit: 10 });
      const warnings = result.warnings.length > 0 ? `${result.warnings.map((w) => `⚠ ${w}`).join("\n")}\n` : "";
      const rows = result.results.map((r) => `${r.path}:${r.startLine}-${r.endLine} ${r.kind}`).join("\n") || "No results";
      ctx.ui.notify(`${warnings}${rows}`, result.stale ? "warning" : "info");
    },
  });

  pi.registerCommand("codebase-context", {
    description: "Get read-first context: /codebase-context <path-or-symbol>",
    handler: async (args, ctx) => {
      const result = codebaseContext({ target: args, cwd: process.cwd(), limit: 8 });
      ctx.ui.notify(JSON.stringify(result, null, 2), "info");
    },
  });
}
