import { Type } from "typebox";

// This metadata is shared only by adapters that expose agent tools (Pi and MCP). Keep it compact:
// descriptions and schemas consume model context on every turn.
export type CodeMapOperationId = "status" | "index" | "search" | "context";

export interface CodeMapOperationMetadata {
  id: CodeMapOperationId;
  label: string;
  toolName: string;
  commandName: string;
  description: string;
  commandDescription: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: any;
}

export const codeMapOperationMetadataById = {
  status: {
    id: "status",
    label: "CodeMap Status",
    toolName: "codemap_status",
    commandName: "codemap-status",
    description: "Show CodeMap approval/index status for cwd or repoPath; full=true does a full file-level stale scan.",
    commandDescription: "Show CodeMap approval/index status; pass --repo-path and/or --full",
    promptSnippet: "Check CodeMap approval/index readiness and stale state.",
    promptGuidelines: [
      "Use codemap_status before search/context if approval or index state is unknown; full=true only for file-level stale scans.",
      "Use codemap_status pathPrefix for monorepos.",
    ],
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Run a full repository scan to report stale index diagnostics." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit diagnostics to an indexed subtree, e.g. services/api/." })),
    }),
  },
  index: {
    id: "index",
    label: "CodeMap Index",
    toolName: "codemap_index",
    commandName: "codemap-index",
    description: "Index/refresh cwd or repoPath; first run needs approveRepo=true.",
    commandDescription: "Index cwd or --repo-path for CodeMap; pass --approve-repo the first time",
    promptSnippet: "Approve once or refresh the CodeMap index for cwd.",
    promptGuidelines: [
      "Use codemap_index approveRepo=true only after explicit local approval.",
      "Use codemap_index when codemap_status says missing or stale.",
      "Use codemap_index pathPrefix to refresh one subtree.",
    ],
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Only index/refresh this repository subtree, e.g. services/api/." })),
    }),
  },
  search: {
    id: "search",
    label: "CodeMap Search",
    toolName: "codemap_search",
    commandName: "codemap-search",
    description: "Ranked search over indexed paths, symbols, and chunks. Best when the target file/symbol is unknown or the query is conceptual ('where does X live', 'what handles Y'). For every occurrence of a known literal or regex, grep/rg is the right tool. Precedes codemap_context.",
    commandDescription: "Search the CodeMap index: /codemap-search [--repo-path <path>] <query>",
    promptSnippet: "Ranked search over indexed paths, symbols, and chunks.",
    promptGuidelines: [
      "Use codemap_search when the target path/symbol is unknown or the query is conceptual; use grep/rg for exhaustive literal/regex matches.",
      "If codemap_search omits the expected result, re-query with new terms or a higher limit before calling codemap_context.",
      "Give codemap_search query terms; add pathPrefix in monorepos; treat stale warnings as advisory.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit to an indexed subtree, e.g. services/api/." })),
    }),
  },
  context: {
    id: "context",
    label: "CodeMap Context",
    toolName: "codemap_context",
    commandName: "codemap-context",
    description: "Read-first neighbors (tests, imports, docs) of a known target — graph relationships grep won't surface. Follow-up to codemap_search; feed it a target you already trust, not a broad query.",
    commandDescription: "Get CodeMap read-first context: /codemap-context [--repo-path <path>] <target>",
    promptSnippet: "Read-first neighbors (tests, imports, docs) of a known target.",
    promptGuidelines: [
      "Use codemap_context on an indexed path or symbol you already trust — pass an exact target, not a broad query.",
      "Do not target codemap_context at an uncertain top search hit (low confidence / near-ties) — it expands whatever it lands on, spending your read budget on the wrong file's neighbors. Widen the search or read the candidate first.",
      "codemap_context returns read-first hints, not a read substitute; pathPrefix scopes monorepos.",
    ],
    parameters: Type.Object({
      target: Type.String({ description: "Indexed path or symbol (preferred); phrase also works." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Scope to an indexed subtree, e.g. services/api/." })),
    }),
  },
} satisfies Record<CodeMapOperationId, CodeMapOperationMetadata>;

export const codeMapOperationMetadata = [
  codeMapOperationMetadataById.status,
  codeMapOperationMetadataById.index,
  codeMapOperationMetadataById.search,
  codeMapOperationMetadataById.context,
] as const;
