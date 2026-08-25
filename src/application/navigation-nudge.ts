import { CODEMAP_BASH_NUDGE_TEXT, CODEMAP_CLI_NUDGE_TEXT, shouldNudgeForCodeMapNavigationCommand } from "../core/bash-nudge.ts";
import { status } from "../core/indexer.ts";
import type { StateOptions } from "../core/repo.ts";

export interface NavigationNudgeResult {
  nudge: boolean;
  readiness?: string;
  root?: string;
  hint?: string;
}

export function codeMapNavigationNudge(
  command: string,
  options: { cwd: string; surface: "cli" | "pi" } & StateOptions,
): NavigationNudgeResult {
  if (!shouldNudgeForCodeMapNavigationCommand(command, { cwd: options.cwd })) return { nudge: false };
  try {
    const repoStatus = status(options.cwd, { stateDir: options.stateDir });
    if (repoStatus.readiness !== "ready" || repoStatus.headChanged) {
      return { nudge: false, readiness: repoStatus.readiness, root: repoStatus.root };
    }
    return {
      nudge: true,
      readiness: repoStatus.readiness,
      root: repoStatus.root,
      hint: options.surface === "cli" ? CODEMAP_CLI_NUDGE_TEXT : CODEMAP_BASH_NUDGE_TEXT,
    };
  } catch {
    return { nudge: false };
  }
}
