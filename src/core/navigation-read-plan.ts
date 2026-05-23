// The scripted eval models an agent that sees search results before context output:
// preserve visible search hits first, then fill remaining read budget from context.
type ContextPathInput = string | { path: string; reasons?: Array<{ kind: string }> };

export function mergeSearchContextReadPlan(searchPaths: string[], contextPaths: ContextPathInput[], limit: number): string[] {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (cappedLimit === 0) return [];
  const contextEntries = contextPaths.map(toContextEntry).filter((item) => item.path);
  const prioritizedContext = contextEntries.filter((item) => isRelatedTest(item) && !searchPaths.includes(item.path));
  const remainingContext = contextEntries.filter((item) => !prioritizedContext.some((priority) => priority.path === item.path));
  return uniquePaths([...searchPaths, ...prioritizedContext.map((item) => item.path), ...remainingContext.map((item) => item.path)]).slice(0, cappedLimit);
}

function toContextEntry(input: ContextPathInput): { path: string; reasons: string[] } {
  return typeof input === "string"
    ? { path: input, reasons: [] }
    : { path: input.path, reasons: input.reasons?.map((reason) => reason.kind) ?? [] };
}

function isRelatedTest(item: { path: string; reasons: string[] }): boolean {
  return item.reasons.some((reason) => reason === "sibling_test" || reason === "reverse_test");
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}
