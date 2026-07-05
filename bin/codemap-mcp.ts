#!/usr/bin/env node
import { createInterface } from "node:readline";

import { dispatch, type JsonRpcRequest, type JsonRpcResponse } from "../src/mcp/server.ts";

// stdio MCP transport: read newline-delimited JSON-RPC messages from stdin, write responses to
// stdout. Nothing but protocol messages may go to stdout; diagnostics would go to stderr.
function write(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  // JSON-RPC batching was removed in MCP 2025-06-18 and this server does not implement it, so an
  // array payload is an invalid request rather than a batch to fan out.
  if (Array.isArray(parsed)) {
    write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: JSON-RPC batching is not supported" } });
    return;
  }
  const response = dispatch(parsed as JsonRpcRequest);
  if (response) write(response);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", handleLine);
