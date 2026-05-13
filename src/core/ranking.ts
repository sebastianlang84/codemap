import { snippet } from "./chunker.ts";
import type { QueryPlan } from "./query-plan.ts";
import type { SearchResult } from "./types.ts";

export interface SearchRow {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  text: string;
  rank: number;
  symbolName?: string | null;
}

export function toResult(row: SearchRow, plan: QueryPlan, boost: number): SearchResult {
  const exactPath = row.path.toLowerCase().includes(plan.normalized);
  const exactText = row.text.toLowerCase().includes(plan.normalized);
  const symbolish = row.kind !== "text" && row.kind !== "markdown" && row.kind !== "file";
  const symbolName = row.symbolName?.toLowerCase() ?? "";
  const exactSymbol = symbolName === plan.normalized;
  const prefixSymbol = plan.terms.some((term) => symbolName.startsWith(term.toLowerCase()));
  const lowerPath = row.path.toLowerCase();
  const lowerText = row.text.toLowerCase();
  const pathCoverage = termCoverage(lowerPath, plan.coreTerms);
  const textCoverage = termCoverage(lowerText, plan.coreTerms);
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  const basenameCoverage = termCoverage(basename, plan.coreTerms);
  const codeLike = /\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|cpp|c|h|hpp|swift|kt|scala|sh|sql)$/.test(lowerPath);
  const sourceLike = /(^|\/)src\//.test(lowerPath);
  const testLike = /(^|\/)(?:test|tests|__tests__)\//.test(lowerPath) || /(?:^|[._-])test\./.test(basename);
  const docLike = /(^|\/)(?:readme|architecture|changelog|todo)(?:\.|$)|\.(?:md|mdx|rst|txt)$/.test(lowerPath);
  const roleBoost = fileRoleBoost(fileRoles(lowerPath), plan.roleIntents);
  const lockPenalty = /(^|[/.-])(?:package-lock|npm-shrinkwrap|yarn\.lock|pnpm-lock|.*\.lock)(?:$|[/.])/.test(row.path) ? 4 : 0;

  return {
    path: row.path,
    language: row.language,
    startLine: row.startLine,
    endLine: row.endLine,
    kind: row.kind,
    snippet: matchSnippet(row.text, plan),
    score:
      boost +
      rankScore(row.rank) +
      (exactPath ? 6 : 0) +
      (lowerPath.endsWith(plan.normalized) ? 3 : 0) +
      (exactText ? 4 : 0) +
      (symbolish && exactText ? 3 : 0) +
      (exactSymbol ? 8 : 0) +
      (prefixSymbol ? 5 : 0) +
      pathCoverage * 5 +
      basenameCoverage * 4 +
      textCoverage * 3 +
      (plan.codeIntent && codeLike ? 2 : 0) +
      (plan.codeIntent && sourceLike ? 4 : 0) +
      roleBoost -
      (plan.codeIntent && testLike ? 3 : 0) -
      (plan.codeIntent && docLike ? 6 : 0) -
      lockPenalty,
  };
}

export function rankAndSlice(results: SearchResult[], limit: number): SearchResult[] {
  return dedupe(results)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, limit);
}

export function fileRoleBoost(roles: string[], intents: string[]): number {
  if (roles.includes("implementation/main") && intents.includes("implementation/main")) return 24;
  if (roles.includes("setup/utility") && intents.includes("setup/utility")) return 22;
  return roles.some((role) => intents.includes(role)) ? 15 : 0;
}

export function fileRoles(path: string): string[] {
  const basename = path.split("/").pop() ?? path;
  const roles: string[] = [];
  if (basename === "readme.md") roles.push("overview");
  if (["program.md", "agents.md", "claude.md"].includes(basename)) roles.push("agent_instructions");
  if (path.startsWith("src/") || /(?:^|\/)src\//.test(path)) roles.push("implementation");
  if (["train.py", "main.py", "index.ts", "index.js"].includes(basename)) roles.push("implementation", "implementation/main");
  if (["prepare.py", "setup.py"].includes(basename)) roles.push("setup/utility");
  if (path.startsWith("scripts/") || /(?:^|\/)scripts\//.test(path)) roles.push("tooling");
  if (path.startsWith("tests/") || /(?:^|\/)(?:test|tests|__tests__)\//.test(path)) roles.push("tests");
  if (["pyproject.toml", "package.json", "requirements.txt", "cargo.toml", "go.mod"].includes(basename)) roles.push("dependencies");
  if (/(?:^|[/.])(?:uv|package|pnpm|yarn|cargo)\.lock$/.test(path) || basename.endsWith(".lock")) roles.push("lockfile");
  return uniqueStrings(roles);
}

function termCoverage(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const hits = terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u").test(text)).length;
  return hits / terms.length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rankScore(rank: number): number {
  if (rank < 0) return 10 + Math.min(5, Math.abs(rank) * 1_000_000);
  return Math.max(0, 10 - rank);
}

function matchSnippet(text: string, plan: QueryPlan): string {
  const lines = text.split(/\r?\n/);
  const needles = [plan.normalized, ...plan.phrases.map((phrase) => phrase.toLowerCase()), ...plan.terms.map((term) => term.toLowerCase())]
    .filter((term) => term.length > 1);
  const index = lines.findIndex((line) => needles.some((term) => line.toLowerCase().includes(term)));
  if (index === -1) return snippet(text);
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 3);
  return snippet(lines.slice(start, end).join("\n"));
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const byKey = new Map<string, SearchResult>();
  for (const result of results) {
    const key = `${result.path}:${result.startLine}:${result.endLine}:${result.kind}`;
    const previous = byKey.get(key);
    if (!previous || result.score > previous.score) byKey.set(key, result);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
