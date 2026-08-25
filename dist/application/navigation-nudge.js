import { CODEMAP_BASH_NUDGE_TEXT, CODEMAP_CLI_NUDGE_TEXT, shouldNudgeForCodeMapNavigationCommand } from "../core/bash-nudge.js";
import { status } from "../core/indexer.js";
export function codeMapNavigationNudge(command, options) {
    if (!shouldNudgeForCodeMapNavigationCommand(command, { cwd: options.cwd }))
        return { nudge: false };
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
    }
    catch {
        return { nudge: false };
    }
}
