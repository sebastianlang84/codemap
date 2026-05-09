import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodebaseWithDiagnostics } from "../core/search.ts";
import { codebaseContext } from "../core/context.ts";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value };
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const stale = record.stale === true ? " (stale)" : "";
    if (Array.isArray(record.results)) return `${record.results.length} result${record.results.length === 1 ? "" : "s"}${stale}`;
    if (Array.isArray(record.matches)) return `${record.matches.length} match${record.matches.length === 1 ? "" : "es"}${stale}`;
    if (Array.isArray(record.readFirst)) return `${record.readFirst.length} read-first item${record.readFirst.length === 1 ? "" : "s"}${stale}`;
    if (typeof record.status === "string") return record.status;
    if (typeof record.message === "string") return record.message;
    if (typeof record.indexed === "boolean") return record.stale === true ? "index stale" : "index ready";
    return Object.keys(record).slice(0, 4).join(", ") || "ok";
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatWarnings(value: unknown, theme: Theme): string[] {
  if (!isRecord(value) || !Array.isArray(value.warnings) || value.warnings.length === 0) return [];
  return value.warnings.slice(0, 3).map((warning) => `${theme.fg("warning", "⚠")} ${String(warning)}`);
}

function formatItem(value: unknown, theme: Theme): string {
  if (!isRecord(value)) return theme.fg("dim", String(value));
  const path = typeof value.path === "string" ? value.path : "<unknown>";
  const start = typeof value.startLine === "number" ? value.startLine : undefined;
  const end = typeof value.endLine === "number" ? value.endLine : start;
  const loc = start ? `${path}:${start}${end && end !== start ? `-${end}` : ""}` : path;
  const kind = typeof value.kind === "string" ? ` ${theme.fg("muted", `[${value.kind}]`)}` : "";
  const snippet = typeof value.snippet === "string" ? ` ${theme.fg("dim", value.snippet.replace(/\s+/g, " ").slice(0, 120))}` : "";
  return `${theme.fg("toolTitle", loc)}${kind}${snippet}`;
}

function formatList(value: unknown, theme: Theme): string[] {
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => formatItem(item, theme));
  if (!isRecord(value)) return [];
  if (Array.isArray(value.results)) return value.results.slice(0, 8).map((item) => formatItem(item, theme));
  if (Array.isArray(value.readFirst)) return value.readFirst.slice(0, 8).map((item) => formatItem(item, theme));
  return [];
}

function renderCodeSearchCall(label: string, detail?: unknown) {
  return (_args: unknown, theme: Theme) => {
    const text = detail === undefined || detail === "" ? "" : ` ${theme.fg("muted", String(detail))}`;
    return new Text(`${theme.fg("toolTitle", theme.bold(label))}${text}`, 0, 0);
  };
}

function renderCodeSearchResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme) {
  const summary = summarizeValue(result.details);
  const warnings = formatWarnings(result.details, theme);
  const list = formatList(result.details, theme);
  const head = `${theme.fg("success", "✓")} ${summary}`;
  const compact = [head, ...warnings, ...list].join("\n");
  if (!options.expanded) {
    const hint = list.length > 0 || warnings.length > 0 ? ` ${theme.fg("dim", keyHint("app.tools.expand", "raw"))}` : ` ${theme.fg("dim", keyHint("app.tools.expand", "details"))}`;
    return new Text(`${compact}${hint}`, 0, 0);
  }

  const body = result.content.find((part) => part.type === "text")?.text ?? summary;
  return new Text(`${compact}\n${theme.fg("dim", body)}`, 0, 0);
}

export function registerCodeSearchTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "codebase_status",
    label: "Codebase Status",
    description: "Show approval and local SQLite index status for the current Git repository.",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      return textResult(status(process.cwd()));
    },
    renderCall: renderCodeSearchCall("codebase_status"),
    renderResult: renderCodeSearchResult,
  });

  pi.registerTool({
    name: "codebase_index",
    label: "Codebase Index",
    description: "Index or refresh the current Git repository. Requires approveRepo=true the first time.",
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
    }),
    async execute(_id, params) {
      return textResult(indexRepo({ cwd: process.cwd(), approve: params.approveRepo === true }));
    },
    renderCall(args, theme) {
      return renderCodeSearchCall("codebase_index", args.approveRepo ? "approve + index" : "refresh")(args, theme);
    },
    renderResult: renderCodeSearchResult,
  });

  pi.registerTool({
    name: "codebase_search",
    label: "Codebase Search",
    description: "Search the indexed repository using SQLite FTS over paths, chunks, and cheap symbols.",
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase to search for." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
    }),
    async execute(_id, params) {
      return textResult(searchCodebaseWithDiagnostics({ query: params.query, limit: params.limit, cwd: process.cwd() }));
    },
    renderCall(args, theme) {
      return renderCodeSearchCall("codebase_search", args.query)(args, theme);
    },
    renderResult: renderCodeSearchResult,
  });

  pi.registerTool({
    name: "codebase_context",
    label: "Codebase Context",
    description: "Return a compact read-first context package for an indexed file path or symbol/query.",
    parameters: Type.Object({
      target: Type.String({ description: "Indexed file path, symbol, subsystem, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
    }),
    async execute(_id, params) {
      return textResult(codebaseContext({ target: params.target, limit: params.limit, cwd: process.cwd() }));
    },
    renderCall(args, theme) {
      return renderCodeSearchCall("codebase_context", args.target)(args, theme);
    },
    renderResult: renderCodeSearchResult,
  });
}
