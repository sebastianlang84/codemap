import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
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

function splitCommandArgs(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const char = args[i];
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function parseCommonArgs(args: string): { flags: Set<string>; pathPrefix?: string; repoPath?: string; query: string } {
  const parts = splitCommandArgs(args);
  const flags = new Set<string>();
  const kept: string[] = [];
  let pathPrefix: string | undefined;
  let repoPath: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--path-prefix") {
      pathPrefix = parts[++i];
    } else if (part.startsWith("--path-prefix=")) {
      pathPrefix = part.slice("--path-prefix=".length);
    } else if (part === "--repo-path") {
      repoPath = parts[++i];
    } else if (part.startsWith("--repo-path=")) {
      repoPath = part.slice("--repo-path=".length);
    } else if (part === "--full" || part === "--approve-repo") {
      flags.add(part);
    } else {
      kept.push(part);
    }
  }
  return { flags, pathPrefix, repoPath, query: kept.join(" ") };
}

export function parsePathPrefix(args: string): { pathPrefix?: string; repoPath?: string; query: string } {
  const { flags: _flags, ...parsed } = parseCommonArgs(args);
  return parsed;
}

function parseStatusArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { full: parsed.flags.has("--full"), pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

function parseIndexArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { approveRepo: parsed.flags.has("--approve-repo"), pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

function parseQueryArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { query: parsed.query, limit: 10, pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

function parseContextArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { target: parsed.query, limit: 8, pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
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

interface RepoPathParams {
  repoPath?: string;
}

function operationCwd(cwd: string, params: RepoPathParams): string {
  if (!params.repoPath) return cwd;
  const target = isAbsolute(params.repoPath) ? params.repoPath : resolve(cwd, params.repoPath);
  if (!existsSync(target)) throw new Error(`repoPath does not exist: ${target}`);
  const stats = statSync(target);
  return stats.isDirectory() ? target : dirname(target);
}

export function codeMapStatus(cwd: string, params: { full?: boolean; pathPrefix?: string; repoPath?: string }) {
  return status(operationCwd(cwd, params), { health: params.full === true ? "full" : "cheap", pathPrefix: params.pathPrefix });
}

export function codeMapIndex(cwd: string, params: { approveRepo?: boolean; pathPrefix?: string; repoPath?: string }) {
  return indexRepo({ cwd: operationCwd(cwd, params), approve: params.approveRepo === true, pathPrefix: params.pathPrefix });
}

export function codeMapSearch(cwd: string, params: { query: string; limit?: number; pathPrefix?: string; repoPath?: string }) {
  return searchCodeMapWithDiagnostics({ query: params.query, cwd: operationCwd(cwd, params), limit: params.limit, pathPrefix: params.pathPrefix });
}

export function codeMapContext(cwd: string, params: { target: string; limit?: number; pathPrefix?: string; repoPath?: string }) {
  return codemapContext({ target: params.target, cwd: operationCwd(cwd, params), limit: params.limit, pathPrefix: params.pathPrefix });
}
