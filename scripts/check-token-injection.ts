#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { codeMapOperationMetadata } from "../src/application/operation-metadata.ts";

export type TokenInjectionFieldName = "description" | "parameters" | "promptSnippet" | "promptGuidelines";

export interface TokenInjectionToolRegistration {
  name: string;
  description?: string;
  parameters?: unknown;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface TokenInjectionFieldReport {
  characters: number;
  tokens: number;
}

export interface TokenInjectionToolReport {
  name: string;
  fields: Record<TokenInjectionFieldName, TokenInjectionFieldReport>;
  total: TokenInjectionFieldReport;
}

export interface TokenInjectionReport {
  generatedAt: string;
  estimator: "chars/4-ceil";
  fields: TokenInjectionFieldName[];
  tools: TokenInjectionToolReport[];
  totals: TokenInjectionFieldReport;
}

export interface TokenInjectionTargets {
  softMaxTokensPerTool: number;
  softMaxTotalTokens: number;
}

export interface TokenInjectionWarning {
  label: string;
  metric: "toolTokens" | "totalTokens";
  target: string;
  actual: number;
}

export interface TokenInjectionAssessment {
  withinTarget: boolean;
  targets: TokenInjectionTargets;
  warnings: TokenInjectionWarning[];
}

const fieldNames: TokenInjectionFieldName[] = ["description", "parameters", "promptSnippet", "promptGuidelines"];

// Soft targets, not hard gates. The tool surface is injected into every agent turn, so minimizing it
// is a standing duty — but cutting past the point where guidance stays clear enough to route the
// agent correctly is not the goal, and every token is expected to earn its place. Exceeding a target
// raises a warning and asks for justification; it does not fail the build. The function side (does the
// wording actually route the agent well) is settled by the routing eval
// (experiments/agent-routing.episodes.md); this report is the pressure on the minimize side. Keep the
// targets close to the current justified footprint so future growth is visible and deliberate.
export const tokenInjectionTargets: TokenInjectionTargets = {
  softMaxTokensPerTool: 300,
  softMaxTotalTokens: 900,
};

export function estimateTokenInjectionTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function buildTokenInjectionReport(tools: TokenInjectionToolRegistration[], generatedAt = new Date().toISOString()): TokenInjectionReport {
  const toolReports = tools.map((tool) => {
    const fields = {
      description: fieldReport(tool.description ?? ""),
      parameters: fieldReport(JSON.stringify(tool.parameters ?? {}) ?? "{}"),
      promptSnippet: fieldReport(tool.promptSnippet ?? ""),
      promptGuidelines: fieldReport((tool.promptGuidelines ?? []).join("\n")),
    } satisfies Record<TokenInjectionFieldName, TokenInjectionFieldReport>;
    const total = sumFields(Object.values(fields));
    return { name: tool.name, fields, total };
  });
  return {
    generatedAt,
    estimator: "chars/4-ceil",
    fields: fieldNames,
    tools: toolReports,
    totals: sumFields(toolReports.map((tool) => tool.total)),
  };
}

export function buildCodeMapTokenInjectionReport(generatedAt?: string): TokenInjectionReport {
  return buildTokenInjectionReport(
    codeMapOperationMetadata.map((operation) => ({
      name: operation.toolName,
      description: operation.description,
      parameters: operation.parameters,
      promptSnippet: operation.promptSnippet,
      promptGuidelines: operation.promptGuidelines,
    })),
    generatedAt,
  );
}

export function assessTokenInjection(report: TokenInjectionReport, targets: TokenInjectionTargets = tokenInjectionTargets): TokenInjectionAssessment {
  const warnings: TokenInjectionWarning[] = [];
  for (const tool of report.tools) {
    if (tool.total.tokens > targets.softMaxTokensPerTool) {
      warnings.push({
        label: tool.name,
        metric: "toolTokens",
        target: `<= ${targets.softMaxTokensPerTool}`,
        actual: tool.total.tokens,
      });
    }
  }
  if (report.totals.tokens > targets.softMaxTotalTokens) {
    warnings.push({
      label: "all CodeMap tools",
      metric: "totalTokens",
      target: `<= ${targets.softMaxTotalTokens}`,
      actual: report.totals.tokens,
    });
  }
  return { withinTarget: warnings.length === 0, targets, warnings };
}

export function formatTokenInjectionWarnings(warnings: TokenInjectionWarning[]): string {
  if (warnings.length === 0) return "";
  return warnings
    .map((warning) => `⚠ ${warning.label} ${warning.metric} ${warning.actual} over soft target ${warning.target} — justify or trim`)
    .join("\n");
}

export function formatTokenInjectionReport(report: TokenInjectionReport, warnings: TokenInjectionWarning[]): string {
  const toolRows = report.tools.map((tool) => {
    const fields = fieldNames.map((name) => `${name}=${tool.fields[name].tokens}`).join(", ");
    return `- ${tool.name}: ${tool.total.tokens} tokens (${fields})`;
  });
  return [formatTokenInjectionWarnings(warnings), "Token injection report:", ...toolRows, `- total: ${report.totals.tokens} tokens`].filter(Boolean).join("\n");
}

function fieldReport(text: string): TokenInjectionFieldReport {
  return { characters: text.length, tokens: estimateTokenInjectionTokens(text) };
}

function sumFields(fields: TokenInjectionFieldReport[]): TokenInjectionFieldReport {
  return {
    characters: fields.reduce((sum, field) => sum + field.characters, 0),
    tokens: fields.reduce((sum, field) => sum + field.tokens, 0),
  };
}

function parseCliArgs(args: string[]): { targets: TokenInjectionTargets } {
  const targets = { ...tokenInjectionTargets };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    // Accepted for back-compat; the check is warn-only now, so this is a no-op flag.
    if (arg === "--budget-gate") {
      continue;
    } else if (name === "--max-tool-tokens") {
      targets.softMaxTokensPerTool = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--max-total-tokens") {
      targets.softMaxTotalTokens = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (arg === "--help") {
      console.log("Usage: check-token-injection.ts [--max-tool-tokens N] [--max-total-tokens N]  (soft targets; reports, never fails)");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { targets };
}

function parsePositiveInteger(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a value`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function runCli(): void {
  const parsed = parseCliArgs(process.argv.slice(2));
  const report = buildCodeMapTokenInjectionReport();
  const assessment = assessTokenInjection(report, parsed.targets);
  console.log(JSON.stringify({ ...report, assessment }, null, 2));
  // Warn-only by design: surface over-target tools loudly for review, but never fail the build —
  // token cost is governed by justification and the routing eval, not a hard cap.
  if (!assessment.withinTarget) console.error(formatTokenInjectionWarnings(assessment.warnings));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
