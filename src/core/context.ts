import { buildCodeMapContext, type CodeMapContextOptions } from "./context-builder.ts";

export function codemapContext(options: CodeMapContextOptions) {
  return buildCodeMapContext(options);
}
