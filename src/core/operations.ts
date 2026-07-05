import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { codemapContext } from "./context.ts";
import { indexRepo, status } from "./indexer.ts";
import { searchCodeMapWithDiagnostics } from "./search.ts";
import type { StateOptions } from "./repo.ts";

// Pi-free execution surface shared by every adapter (Pi extension, CLI, MCP server). Each function
// takes a base cwd plus the tool params and calls straight into core; adapters stay thin.

export interface RepoPathParams extends StateOptions {
  repoPath?: string;
}

export function operationCwd(cwd: string, params: RepoPathParams): string {
  if (!params.repoPath) return cwd;
  const target = isAbsolute(params.repoPath) ? params.repoPath : resolve(cwd, params.repoPath);
  if (!existsSync(target)) throw new Error(`repoPath does not exist: ${target}`);
  const stats = statSync(target);
  return stats.isDirectory() ? target : dirname(target);
}

export function codeMapStatus(cwd: string, params: RepoPathParams & { full?: boolean; pathPrefix?: string }) {
  return status(operationCwd(cwd, params), { health: params.full === true ? "full" : "cheap", pathPrefix: params.pathPrefix, stateDir: params.stateDir });
}

export function codeMapIndex(cwd: string, params: RepoPathParams & { approveRepo?: boolean; pathPrefix?: string }) {
  return indexRepo({ cwd: operationCwd(cwd, params), approve: params.approveRepo === true, pathPrefix: params.pathPrefix, stateDir: params.stateDir });
}

export function codeMapSearch(cwd: string, params: RepoPathParams & { query: string; limit?: number; pathPrefix?: string }) {
  return searchCodeMapWithDiagnostics({ query: params.query, cwd: operationCwd(cwd, params), limit: params.limit, pathPrefix: params.pathPrefix, stateDir: params.stateDir });
}

export function codeMapContext(cwd: string, params: RepoPathParams & { target: string; limit?: number; pathPrefix?: string }) {
  return codemapContext({ target: params.target, cwd: operationCwd(cwd, params), limit: params.limit, pathPrefix: params.pathPrefix, stateDir: params.stateDir });
}
