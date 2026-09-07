// Assignments expose the target name; a function expression's private name may differ.
export function assignedFunctionNames(line) {
    const match = line.match(/^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*(?:async\s+)?function(?:\s*\*\s*(?:[A-Za-z_$][\w$]*\s*)?|\s+(?:[A-Za-z_$][\w$]*\s*)?)?\(/);
    if (!match)
        return [];
    const name = match[1].replace(/\s+/g, "");
    const shortName = name.slice(name.lastIndexOf(".") + 1);
    return name === shortName ? [name] : [name, shortName];
}
export function methodName(line) {
    const head = line.match(/^\s*(?:public\s+|private\s+|protected\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (!head)
        return undefined;
    let depth = 0;
    let quote;
    let escape = false;
    for (let i = head[0].length - 1; i < line.length; i++) {
        const char = line[i];
        if (quote) {
            if (escape) {
                escape = false;
                continue;
            }
            if (char === "\\") {
                escape = true;
                continue;
            }
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === "/" && line[i + 1] === "/")
            return undefined;
        if (char === "/" && line[i + 1] === "*") {
            const end = line.indexOf("*/", i + 2);
            if (end < 0)
                return undefined;
            i = end + 1;
            continue;
        }
        if (char === "/" && isRegexStart(line, i)) {
            const end = regexEnd(line, i);
            if (end === i)
                return undefined;
            i = end;
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }
        if (char === "(")
            depth++;
        // A callback's closing parenthesis is not the end of the outer call's arguments.
        if (char === ")" && --depth === 0) {
            return /^\s*[:{]/.test(line.slice(i + 1)) ? head[1] : undefined;
        }
    }
    return undefined;
}
export function isRegexStart(line, slashIndex) {
    const before = line.slice(0, slashIndex).trimEnd();
    if (!before)
        return true;
    if (/\b(return|throw|yield)$/.test(before) || before.endsWith("=>"))
        return true;
    const previous = before[before.length - 1];
    return "=([{!?:;,|&".includes(previous);
}
export function regexEnd(line, slashIndex) {
    let inClass = false;
    let escape = false;
    for (let i = slashIndex + 1; i < line.length; i++) {
        const char = line[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (char === "\\") {
            escape = true;
            continue;
        }
        if (char === "[") {
            inClass = true;
            continue;
        }
        if (char === "]") {
            inClass = false;
            continue;
        }
        if (char === "/" && !inClass)
            return i;
    }
    return slashIndex;
}
