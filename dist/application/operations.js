import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { codemapContext } from "../core/context.js";
import { indexRepo, status } from "../core/indexer.js";
import { searchCodeMapWithDiagnostics } from "../core/search.js";
export function operationCwd(cwd, params) {
    if (!params.repoPath)
        return cwd;
    const target = isAbsolute(params.repoPath) ? params.repoPath : resolve(cwd, params.repoPath);
    if (!existsSync(target))
        throw new Error(`repoPath does not exist: ${target}`);
    const stats = statSync(target);
    return stats.isDirectory() ? target : dirname(target);
}
export function codeMapStatus(cwd, params) {
    return status(operationCwd(cwd, params), {
        health: params.full === true ? "full" : "cheap",
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
    });
}
export function codeMapIndex(cwd, params) {
    return indexRepo({
        cwd: operationCwd(cwd, params),
        approve: params.approveRepo === true,
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
    });
}
export function codeMapSearch(cwd, params) {
    return searchCodeMapWithDiagnostics({
        query: params.query,
        cwd: operationCwd(cwd, params),
        limit: params.limit,
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
    });
}
export function codeMapContext(cwd, params) {
    return codemapContext({
        target: params.target,
        cwd: operationCwd(cwd, params),
        limit: params.limit,
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
    });
}
