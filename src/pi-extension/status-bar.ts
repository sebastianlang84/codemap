import { status } from "../core/indexer.ts";

export const STATUS_KEY = "codemap";
const STATUS_OK_TEXT = "[CodeMap ✓]";
const STATUS_NOT_INDEXED_TEXT = "[CodeMap ✗]";
const STATUS_ERROR_TEXT = "[CodeMap ✗]";

/** Compute the footer status pill for a repo root. Never throws. */
export function computeStatusText(cwd: string): string {
  try {
    return status(cwd, { health: "cheap" }).readiness === "ready" ? STATUS_OK_TEXT : STATUS_NOT_INDEXED_TEXT;
  } catch {
    return STATUS_ERROR_TEXT;
  }
}
