import { Type } from "typebox";

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
    description: "Show CodeMap approval and local SQLite index status for the current Git repository. Uses cheap diagnostics unless full=true.",
    commandDescription: "Show CodeMap approval/index status; pass --full for stale diagnostics",
    promptSnippet: "Check CodeMap approval/index readiness and stale state for cwd.",
    promptGuidelines: [
      "Use codemap_status before search/context when approval or index state is unknown.",
      "Use codemap_status full=true only for stale diagnostics.",
      "Use codemap_status pathPrefix for monorepos.",
    ],
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Run a full repository scan to report stale index diagnostics." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit diagnostics to an indexed subtree, e.g. services/api/." })),
    }),
  },
  index: {
    id: "index",
    label: "CodeMap Index",
    toolName: "codemap_index",
    commandName: "codemap-index",
    description: "Index or refresh the current Git repository for CodeMap. Requires approveRepo=true the first time.",
    commandDescription: "Index current repo for CodeMap; pass --approve-repo the first time",
    promptSnippet: "Approve once or refresh the CodeMap index for cwd.",
    promptGuidelines: [
      "Use codemap_index approveRepo=true only after explicit local approval.",
      "Use codemap_index when codemap_status says missing or stale.",
      "Use codemap_index pathPrefix to refresh one subtree.",
    ],
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
      pathPrefix: Type.Optional(Type.String({ description: "Only index/refresh this repository subtree, e.g. services/api/." })),
    }),
  },
  search: {
    id: "search",
    label: "CodeMap Search",
    toolName: "codemap_search",
    commandName: "codemap-search",
    description: "Search the CodeMap index using SQLite FTS over paths, chunks, and cheap symbols.",
    commandDescription: "Search the CodeMap index: /codemap-search <query>",
    promptSnippet: "Search indexed CodeMap paths, chunks, and symbols by query.",
    promptGuidelines: [
      "Use codemap_search for navigation when target path/symbol is unknown.",
      "Use codemap_search query terms; add pathPrefix in monorepos.",
      "Treat codemap_search stale warnings as advisory.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase to search for." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit results to an indexed subtree, e.g. services/api/." })),
    }),
  },
  context: {
    id: "context",
    label: "CodeMap Context",
    toolName: "codemap_context",
    commandName: "codemap-context",
    description: "Return a compact read-first context package from CodeMap for an indexed file path or symbol/query.",
    commandDescription: "Get CodeMap read-first context: /codemap-context <path-or-symbol>",
    promptSnippet: "Get read-first context from indexed CodeMap files or query matches.",
    promptGuidelines: [
      "Use codemap_context after codemap_search to choose files to read.",
      "Use codemap_context for read-first hints, not as a read substitute.",
      "Use codemap_context pathPrefix to scope monorepos.",
    ],
    parameters: Type.Object({
      target: Type.String({ description: "Indexed file path, symbol, subsystem, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit lookup to an indexed subtree, e.g. services/api/." })),
    }),
  },
} satisfies Record<CodeMapOperationId, CodeMapOperationMetadata>;

export const codeMapOperationMetadata = [
  codeMapOperationMetadataById.status,
  codeMapOperationMetadataById.index,
  codeMapOperationMetadataById.search,
  codeMapOperationMetadataById.context,
] as const;
