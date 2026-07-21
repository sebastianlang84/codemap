import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
// Harness-neutral grep/rg/find navigation heuristic. Lives in core (not the Pi adapter) so every
// surface — the Pi tool_result hook and the `codemap nudge-check` CLI subcommand — shares one
// implementation. Pure: only reads file stats to tell a concrete file path from a broad search.
export const CODEMAP_BASH_NUDGE_TEXT = "CodeMap hint: repo is indexed; for broad navigation use codemap_search, then codemap_context before more grep/rg/find.";
// CLI-surface variant of the hint, naming the CLI commands rather than the Pi tool names.
export const CODEMAP_CLI_NUDGE_TEXT = "CodeMap hint: repo is indexed; for broad navigation try 'codemap search <terms>', then 'codemap context <hit>' before more grep/rg/find.";
const RG_OPTIONS_WITH_VALUE = new Set([
    "-A",
    "-B",
    "-C",
    "-e",
    "-f",
    "-g",
    "-m",
    "-t",
    "-T",
    "--after-context",
    "--before-context",
    "--context",
    "--context-separator",
    "--engine",
    "--field-context-separator",
    "--field-match-separator",
    "--glob",
    "--iglob",
    "--max-count",
    "--max-depth",
    "--path-separator",
    "--pre",
    "--regexp",
    "--replace",
    "--sort",
    "--sortr",
    "--type",
    "--type-add",
    "--type-clear",
]);
const GREP_OPTIONS_WITH_VALUE = new Set([
    "-A",
    "-B",
    "-C",
    "-D",
    "-d",
    "-e",
    "-f",
    "-m",
    "--after-context",
    "--before-context",
    "--binary-files",
    "--context",
    "--directories",
    "--exclude",
    "--exclude-dir",
    "--exclude-from",
    "--file",
    "--include",
    "--label",
    "--max-count",
    "--regexp",
]);
const COMMON_EXTENSIONLESS_FILES = new Set(["AGENTS", "CHANGELOG", "Dockerfile", "LICENSE", "Makefile", "NOTICE", "README", "TODO"]);
export function shouldNudgeForCodeMapNavigationCommand(command, options = {}) {
    return splitShellSegments(command).some((segment) => segmentShouldNudge(segment, options));
}
function segmentShouldNudge(segment, options) {
    const tokens = unwrapCommand(splitShellWords(segment.text));
    if (tokens.length === 0)
        return false;
    const commandName = basename(tokens[0]);
    if (commandName === "rg")
        return rgShouldNudge(tokens.slice(1), options);
    if (commandName === "grep")
        return grepShouldNudge(tokens.slice(1), { ...options, startsAfterPipe: segment.startsAfterPipe, defaultRecursive: false });
    if (commandName === "find")
        return findShouldNudge(tokens.slice(1), options);
    if (commandName === "git") {
        const grepIndex = tokens.findIndex((token, index) => index > 0 && token === "grep");
        if (grepIndex >= 0)
            return grepShouldNudge(tokens.slice(grepIndex + 1), { ...options, startsAfterPipe: false, defaultRecursive: true });
    }
    return false;
}
function rgShouldNudge(args, options) {
    const { paths, filesMode } = collectRipgrepPathOperands(args);
    if (filesMode)
        return paths.length === 0 || paths.some((path) => !isLikelyConcreteFilePath(path, options.cwd));
    if (paths.length === 0)
        return true;
    return paths.some((path) => !isLikelyConcreteFilePath(path, options.cwd));
}
function grepShouldNudge(args, options) {
    const { paths, recursive } = collectGrepPathOperands(args, options.defaultRecursive);
    if (!recursive && paths.length === 0)
        return false;
    if (options.startsAfterPipe && !recursive && paths.length === 0)
        return false;
    if (recursive && paths.length === 0)
        return true;
    return paths.some((path) => !isLikelyConcreteFilePath(path, options.cwd));
}
function findShouldNudge(args, options) {
    if (args.some((arg) => arg === "-delete" || arg === "-exec" || arg === "-execdir" || arg === "-ok" || arg === "-okdir"))
        return false;
    const roots = [];
    for (const arg of args) {
        if (arg === "(" || arg === ")" || arg === "!" || arg.startsWith("-"))
            break;
        roots.push(arg);
    }
    const effectiveRoots = roots.length > 0 ? roots : ["."];
    return effectiveRoots.some((path) => !isLikelyConcreteFilePath(path, options.cwd));
}
function collectRipgrepPathOperands(args) {
    const paths = [];
    let filesMode = false;
    let sawPattern = false;
    let afterDoubleDash = false;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--") {
            afterDoubleDash = true;
            continue;
        }
        if (!afterDoubleDash && arg === "--files") {
            filesMode = true;
            continue;
        }
        if (!afterDoubleDash && arg.startsWith("-")) {
            const optionName = optionNameFor(arg);
            const takesValue = RG_OPTIONS_WITH_VALUE.has(optionName) || /^-[ABCefgmtT]$/.test(optionName);
            const attachedValue = /^-[ABCefgmtT].+/.test(arg) || arg.includes("=");
            if (optionName === "-e" || optionName === "--regexp")
                sawPattern = true;
            if (takesValue && !attachedValue)
                index += 1;
            continue;
        }
        if (filesMode) {
            paths.push(arg);
        }
        else if (!sawPattern) {
            sawPattern = true;
        }
        else {
            paths.push(arg);
        }
    }
    return { paths, filesMode };
}
function collectGrepPathOperands(args, defaultRecursive) {
    const paths = [];
    let recursive = defaultRecursive;
    let sawPattern = false;
    let afterDoubleDash = false;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--") {
            afterDoubleDash = true;
            continue;
        }
        if (!afterDoubleDash && arg.startsWith("-")) {
            const optionName = optionNameFor(arg);
            if (optionName === "-R" || optionName === "-r" || optionName === "--recursive")
                recursive = true;
            const takesValue = GREP_OPTIONS_WITH_VALUE.has(optionName) || /^-[ABCDefm]$/.test(optionName);
            const attachedValue = /^-[ABCDefm].+/.test(arg) || arg.includes("=");
            if (optionName === "-e" || optionName === "--regexp")
                sawPattern = true;
            if (takesValue && !attachedValue)
                index += 1;
            continue;
        }
        if (!sawPattern) {
            sawPattern = true;
        }
        else {
            paths.push(arg);
        }
    }
    return { paths, recursive };
}
function isLikelyConcreteFilePath(path, cwd) {
    if (!path || path === "." || path === ".." || path.endsWith("/"))
        return false;
    if (/[*?[\]{}]/.test(path))
        return false;
    if (cwd) {
        try {
            const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
            return statSync(absolutePath).isFile();
        }
        catch {
            // Fall back to path-shape heuristics below.
        }
    }
    const name = basename(path);
    if (COMMON_EXTENSIONLESS_FILES.has(name))
        return true;
    return /\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}
function optionNameFor(arg) {
    if (arg.startsWith("--"))
        return arg.split("=", 1)[0] ?? arg;
    if (/^-[A-Za-z]$/.test(arg))
        return arg;
    const match = arg.match(/^-[A-Za-z]/);
    return match?.[0] ?? arg;
}
function unwrapCommand(tokens) {
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) {
            index += 1;
            continue;
        }
        if (token === "command" || token === "builtin" || token === "noglob") {
            index += 1;
            continue;
        }
        if (token === "env") {
            index += 1;
            while (index < tokens.length && (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])))
                index += 1;
            continue;
        }
        if (token === "sudo") {
            index += 1;
            while (index < tokens.length && tokens[index].startsWith("-"))
                index += 1;
            continue;
        }
        break;
    }
    return tokens.slice(index);
}
function splitShellSegments(command) {
    const segments = [];
    let current = "";
    let quote;
    let escaped = false;
    let startsAfterPipe = false;
    const push = (nextStartsAfterPipe) => {
        const text = current.trim();
        if (text)
            segments.push({ text, startsAfterPipe });
        current = "";
        startsAfterPipe = nextStartsAfterPipe;
    };
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            current += char;
            escaped = true;
            continue;
        }
        if (quote) {
            current += char;
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === "'" || char === '"') {
            current += char;
            quote = char;
            continue;
        }
        if (char === ";" || char === "\n") {
            push(false);
            continue;
        }
        if (char === "&" && command[index + 1] === "&") {
            index += 1;
            push(false);
            continue;
        }
        if (char === "|" && command[index + 1] === "|") {
            index += 1;
            push(false);
            continue;
        }
        if (char === "|") {
            push(true);
            continue;
        }
        current += char;
    }
    push(false);
    return segments;
}
function splitShellWords(segment) {
    const words = [];
    let current = "";
    let quote;
    let escaped = false;
    const push = () => {
        if (current)
            words.push(current);
        current = "";
    };
    for (const char of segment) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = undefined;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            push();
            continue;
        }
        current += char;
    }
    push();
    return words;
}
function basename(path) {
    return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}
