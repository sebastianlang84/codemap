import { codemapContext } from "../core/context.ts";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodeMapWithDiagnostics } from "../core/search.ts";

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
