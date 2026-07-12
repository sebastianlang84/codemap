const fixedChunkSize = 80;
const fixedChunkOverlap = 10;
const structuredLanguages = new Set(["typescript", "javascript", "tsx", "jsx", "python", "py"]);
export function chunkText(text, language) {
    const lines = text.split(/\r?\n/);
    if (language === "markdown")
        return chunkMarkdown(lines);
    if (structuredLanguages.has(language))
        return chunkStructuredCode(lines, language);
    return chunkFixed(lines);
}
function chunkFixed(lines, kind = "text", startIndex = 0, ordinalStart = 0) {
    const chunks = [];
    for (let start = 0, ordinal = ordinalStart; start < lines.length; start += fixedChunkSize - fixedChunkOverlap, ordinal++) {
        const end = Math.min(lines.length, start + fixedChunkSize);
        chunks.push({ ordinal, startLine: startIndex + start + 1, endLine: startIndex + end, kind, text: lines.slice(start, end).join("\n") });
        if (end === lines.length)
            break;
    }
    return chunks;
}
function renumber(chunks) {
    return chunks.map((chunk, ordinal) => ({ ...chunk, ordinal }));
}
function chunkMarkdown(lines) {
    const chunks = [];
    let start = 0;
    let activeFence;
    for (let i = 0; i < lines.length; i++) {
        if (activeFence) {
            if (closesFence(lines[i], activeFence))
                activeFence = undefined;
            continue;
        }
        const fence = fenceMarker(lines[i]);
        if (fence) {
            activeFence = fence;
            continue;
        }
        if (i > 0 && /^#{1,3}\s+/.test(lines[i]) && i - start > 8) {
            chunks.push({ startLine: start + 1, endLine: i, kind: "markdown", text: lines.slice(start, i).join("\n") });
            start = i;
        }
    }
    if (start < lines.length)
        chunks.push({ startLine: start + 1, endLine: lines.length, kind: "markdown", text: lines.slice(start).join("\n") });
    return renumber(chunks);
}
function fenceMarker(line) {
    return line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
}
function closesFence(line, activeFence) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/)?.[1];
    return Boolean(marker && marker[0] === activeFence[0] && marker.length >= activeFence.length);
}
function chunkStructuredCode(lines, language) {
    const chunks = [];
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
        const kind = structureKind(lines[i], language);
        if (!kind)
            continue;
        if (i > cursor)
            chunks.push(...chunkFixed(lines.slice(cursor, i), "text", cursor).map(({ ordinal: _ordinal, ...chunk }) => chunk));
        const end = language === "python" || language === "py" ? pythonBlockEnd(lines, i) : braceBlockEnd(lines, i);
        chunks.push({ startLine: i + 1, endLine: end + 1, kind, text: lines.slice(i, end + 1).join("\n") });
        cursor = end + 1;
        i = end;
    }
    if (cursor < lines.length)
        chunks.push(...chunkFixed(lines.slice(cursor), "text", cursor).map(({ ordinal: _ordinal, ...chunk }) => chunk));
    return chunks.length > 0 ? renumber(chunks) : chunkFixed(lines);
}
function structureKind(line, language) {
    if (language === "python" || language === "py") {
        if (/^\s*class\s+[A-Za-z_][\w_]*/.test(line))
            return "class";
        if (/^\s*(async\s+)?def\s+[A-Za-z_][\w_]*/.test(line))
            return "function";
        return undefined;
    }
    if (/^\s*(export\s+)?(default\s+)?(abstract\s+)?class(\s+[A-Za-z_$][\w$]*)?(<.*>)?\b/.test(line))
        return "class";
    if (/^\s*(export\s+)?(default\s+)?(async\s+)?function(\s+[A-Za-z_$][\w$]*)?(<.*>)?\s*\(/.test(line))
        return "function";
    if (/^\s*export\s+default\s+(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(line))
        return "function";
    if (isConstArrowDeclaration(line))
        return "function";
    return undefined;
}
function isConstArrowDeclaration(line) {
    const declaration = line.match(/^\s*(export\s+)?const\s+[A-Za-z_$][\w$]*/);
    if (!declaration)
        return false;
    const rhs = assignmentRhs(line.slice(declaration[0].length));
    return Boolean(rhs?.trim().match(/^(async\s*)?(<.*>\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/));
}
function assignmentRhs(rest) {
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "=" && rest[i + 1] !== ">")
            return rest.slice(i + 1);
    }
    return undefined;
}
function braceBlockEnd(lines, start) {
    let depth = 0;
    let bodyStarted = false;
    const state = { blockComment: false, quote: undefined, escape: false };
    for (let i = start; i < lines.length; i++) {
        const delta = braceDelta(lines[i], state);
        depth += delta.depth;
        if (i === start && !delta.opened && /=>\s*$/.test(lines[i]))
            return expressionContinuationEnd(lines, i);
        if (i === start && !delta.opened && /=>/.test(lines[i]))
            return i;
        if (delta.opened && hasBodyOpen(lines[i]))
            bodyStarted = true;
        if (bodyStarted && depth <= 0)
            return i;
    }
    return start;
}
function braceDelta(line, state) {
    let depth = 0;
    let opened = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];
        if (state.blockComment) {
            if (char === "*" && next === "/") {
                state.blockComment = false;
                i++;
            }
            continue;
        }
        if (state.quote) {
            if (state.escape) {
                state.escape = false;
                continue;
            }
            if (char === "\\") {
                state.escape = true;
                continue;
            }
            if (char === state.quote)
                state.quote = undefined;
            continue;
        }
        if (char === "/" && next === "/")
            break;
        if (char === "/" && next === "*") {
            state.blockComment = true;
            i++;
            continue;
        }
        if (char === "/" && isRegexStart(line, i)) {
            i = regexEnd(line, i);
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            state.quote = char;
            continue;
        }
        if (char === "{") {
            depth++;
            opened = true;
        }
        else if (char === "}")
            depth--;
    }
    if (state.quote !== "`")
        state.quote = undefined;
    state.escape = false;
    return { depth, opened };
}
function isRegexStart(line, slashIndex) {
    const before = line.slice(0, slashIndex).trimEnd();
    if (!before)
        return true;
    if (/\b(return|throw|yield)$/.test(before) || before.endsWith("=>"))
        return true;
    const previous = before[before.length - 1];
    return "=([{!?:;,|&".includes(previous);
}
function regexEnd(line, slashIndex) {
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
function hasBodyOpen(line) {
    return /\)\s*(:.*)?\{/.test(line) || /=>\s*\{/.test(line) || /\b(class|interface|enum)\b.*\{/.test(line);
}
function expressionContinuationEnd(lines, start) {
    const baseIndent = indentOf(lines[start]);
    let lastNonBlank = start;
    for (let i = start + 1; i < lines.length; i++) {
        if (!lines[i].trim())
            continue;
        if (indentOf(lines[i]) <= baseIndent)
            return lastNonBlank;
        lastNonBlank = i;
    }
    return lastNonBlank;
}
function pythonBlockEnd(lines, start) {
    const baseIndent = indentOf(lines[start]);
    let lastNonBlank = start;
    for (let i = start + 1; i < lines.length; i++) {
        if (!lines[i].trim())
            continue;
        if (indentOf(lines[i]) <= baseIndent)
            return lastNonBlank;
        lastNonBlank = i;
    }
    return lastNonBlank;
}
function indentOf(line) {
    return line.match(/^\s*/)?.[0].length ?? 0;
}
export function snippet(text, max = 700) {
    const compact = text.replace(/\n{3,}/g, "\n\n").trim();
    return compact.length <= max ? compact : compact.slice(0, max - 1).trimEnd() + "…";
}
