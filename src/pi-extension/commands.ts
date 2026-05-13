import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { codeMapContext, codeMapIndex, codeMapSearch, codeMapStatus, parsePathPrefix } from "./operations.ts";

function registerStatusCommand(pi: ExtensionAPI, name: string, deprecatedAliasFor?: string): void {
  pi.registerCommand(name, {
    description: deprecatedAliasFor
      ? `Deprecated alias for /${deprecatedAliasFor}. Show CodeMap approval/index status; pass --full for stale diagnostics`
      : "Show CodeMap approval/index status; pass --full for stale diagnostics",
    handler: async (args, ctx) => {
      const parsed = parsePathPrefix(args);
      ctx.ui.notify(JSON.stringify(codeMapStatus(process.cwd(), { full: args.includes("--full"), pathPrefix: parsed.pathPrefix }), null, 2), "info");
    },
  });
}

function registerIndexCommand(pi: ExtensionAPI, name: string, deprecatedAliasFor?: string): void {
  pi.registerCommand(name, {
    description: deprecatedAliasFor
      ? `Deprecated alias for /${deprecatedAliasFor}. Index current repo for CodeMap; pass --approve-repo the first time`
      : "Index current repo for CodeMap; pass --approve-repo the first time",
    handler: async (args, ctx) => {
      const parsed = parsePathPrefix(args);
      const result = codeMapIndex(process.cwd(), { approveRepo: args.includes("--approve-repo"), pathPrefix: parsed.pathPrefix });
      ctx.ui.notify(`Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped)`, "info");
    },
  });
}

function registerSearchCommand(pi: ExtensionAPI, name: string, deprecatedAliasFor?: string): void {
  pi.registerCommand(name, {
    description: deprecatedAliasFor
      ? `Deprecated alias for /${deprecatedAliasFor}. Search the CodeMap index: /${deprecatedAliasFor} <query>`
      : "Search the CodeMap index: /codemap-search <query>",
    handler: async (args, ctx) => {
      const parsed = parsePathPrefix(args);
      const result = codeMapSearch(process.cwd(), { query: parsed.query, limit: 10, pathPrefix: parsed.pathPrefix });
      const warnings = result.warnings.length > 0 ? `${result.warnings.map((w) => `⚠ ${w}`).join("\n")}\n` : "";
      const rows = result.results.map((r) => `${r.path}:${r.startLine}-${r.endLine} ${r.kind}`).join("\n") || "No results";
      ctx.ui.notify(`${warnings}${rows}`, result.stale ? "warning" : "info");
    },
  });
}

function registerContextCommand(pi: ExtensionAPI, name: string, deprecatedAliasFor?: string): void {
  pi.registerCommand(name, {
    description: deprecatedAliasFor
      ? `Deprecated alias for /${deprecatedAliasFor}. Get CodeMap read-first context: /${deprecatedAliasFor} <path-or-symbol>`
      : "Get CodeMap read-first context: /codemap-context <path-or-symbol>",
    handler: async (args, ctx) => {
      const parsed = parsePathPrefix(args);
      const result = codeMapContext(process.cwd(), { target: parsed.query, limit: 8, pathPrefix: parsed.pathPrefix });
      ctx.ui.notify(JSON.stringify(result, null, 2), "info");
    },
  });
}

export function registerCodeMapCommands(pi: ExtensionAPI): void {
  registerStatusCommand(pi, "codemap-status");
  registerIndexCommand(pi, "codemap-index");
  registerSearchCommand(pi, "codemap-search");
  registerContextCommand(pi, "codemap-context");

  registerStatusCommand(pi, "codebase-status", "codemap-status");
  registerIndexCommand(pi, "codebase-index", "codemap-index");
  registerSearchCommand(pi, "codebase-search", "codemap-search");
  registerContextCommand(pi, "codebase-context", "codemap-context");
}
