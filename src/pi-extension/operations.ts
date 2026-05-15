import { codemapContext } from "../core/context.ts";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodeMapWithDiagnostics } from "../core/search.ts";
import { codeMapOperationMetadataById, type CodeMapOperationMetadata } from "./operation-metadata.ts";

export type CommandNotifyLevel = "info" | "warning" | "error";

export interface CommandNotification {
  message: string;
  level: CommandNotifyLevel;
}

export interface CodeMapOperation extends CodeMapOperationMetadata {
  execute(cwd: string, params: any): any;
  parseCommandArgs(args: string): any;
  formatCommandResult(result: any): CommandNotification;
  renderCallDetail?(params: any): string | undefined;
}

export function parsePathPrefix(args: string): { pathPrefix?: string; query: string } {
  const parts = args.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let pathPrefix: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--path-prefix") {
      pathPrefix = parts[++i];
    } else if (part.startsWith("--path-prefix=")) {
      pathPrefix = part.slice("--path-prefix=".length);
    } else {
      kept.push(part);
    }
  }
  return { pathPrefix, query: kept.join(" ") };
}

function parseStatusArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { full: args.includes("--full"), pathPrefix: parsed.pathPrefix };
}

function parseIndexArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { approveRepo: args.includes("--approve-repo"), pathPrefix: parsed.pathPrefix };
}

function parseQueryArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { query: parsed.query, limit: 10, pathPrefix: parsed.pathPrefix };
}

function parseContextArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { target: parsed.query, limit: 8, pathPrefix: parsed.pathPrefix };
}

export const codeMapOperations: readonly CodeMapOperation[] = [
  {
    ...codeMapOperationMetadataById.status,
    execute: codeMapStatus,
    parseCommandArgs: parseStatusArgs,
    formatCommandResult(result) {
      return { message: JSON.stringify(result, null, 2), level: "info" };
    },
  },
  {
    ...codeMapOperationMetadataById.index,
    execute: codeMapIndex,
    parseCommandArgs: parseIndexArgs,
    formatCommandResult(result) {
      return { message: `Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped)`, level: "info" };
    },
    renderCallDetail(params) {
      return params.approveRepo ? "approve + index" : "refresh";
    },
  },
  {
    ...codeMapOperationMetadataById.search,
    execute: codeMapSearch,
    parseCommandArgs: parseQueryArgs,
    formatCommandResult(result) {
      const warnings = result.warnings.length > 0 ? `${result.warnings.map((warning: string) => `⚠ ${warning}`).join("\n")}\n` : "";
      const rows = result.results.map((row: { path: string; startLine: number; endLine: number; kind: string }) => `${row.path}:${row.startLine}-${row.endLine} ${row.kind}`).join("\n") || "No results";
      return { message: `${warnings}${rows}`, level: result.stale ? "warning" : "info" };
    },
    renderCallDetail(params) {
      return params.query;
    },
  },
  {
    ...codeMapOperationMetadataById.context,
    execute: codeMapContext,
    parseCommandArgs: parseContextArgs,
    formatCommandResult(result) {
      return { message: JSON.stringify(result, null, 2), level: "info" };
    },
    renderCallDetail(params) {
      return params.target;
    },
  },
];

export function codeMapStatus(cwd: string, params: { full?: boolean; pathPrefix?: string }) {
  return status(cwd, { health: params.full === true ? "full" : "cheap", pathPrefix: params.pathPrefix });
}

export function codeMapIndex(cwd: string, params: { approveRepo?: boolean; pathPrefix?: string }) {
  return indexRepo({ cwd, approve: params.approveRepo === true, pathPrefix: params.pathPrefix });
}

export function codeMapSearch(cwd: string, params: { query: string; limit?: number; pathPrefix?: string }) {
  return searchCodeMapWithDiagnostics({ query: params.query, cwd, limit: params.limit, pathPrefix: params.pathPrefix });
}

export function codeMapContext(cwd: string, params: { target: string; limit?: number; pathPrefix?: string }) {
  return codemapContext({ target: params.target, cwd, limit: params.limit, pathPrefix: params.pathPrefix });
}
