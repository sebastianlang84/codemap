#!/usr/bin/env node
import { createInterface } from "node:readline";
import { dispatch } from "./server.js";
// Stdio MCP transport: stdout is reserved for newline-delimited JSON-RPC responses.
function write(response) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
}
function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return;
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
    }
    if (Array.isArray(parsed)) {
        write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: JSON-RPC batching is not supported" } });
        return;
    }
    if (!parsed || typeof parsed !== "object") {
        write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: expected a JSON-RPC object" } });
        return;
    }
    let response;
    try {
        response = dispatch(parsed);
    }
    catch (error) {
        // Keep the transport alive: one bad message must not end the session for every later request.
        const id = parsed.id;
        response = { jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null, error: { code: -32603, message: `Internal error: ${error instanceof Error ? error.message : String(error)}` } };
    }
    if (response)
        write(response);
}
const rl = createInterface({ input: process.stdin });
rl.on("line", handleLine);
