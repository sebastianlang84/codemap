import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Shared by the CLI (`codemap --version`) and the telemetry seam (`tool_version` envelope field), so
// both report the same version from the same lookup. Source (src/core) and compiled (dist/core) layouts
// sit at the same depth below the package root, so the two candidate paths cover both.
export function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const pkgPath of [join(here, "..", "..", "package.json"), join(here, "..", "..", "..", "package.json")]) {
    if (!existsSync(pkgPath)) continue;
    try {
      return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
    } catch {
      // Keep looking: source and compiled layouts place package.json at different depths.
    }
  }
  return "0.0.0";
}
