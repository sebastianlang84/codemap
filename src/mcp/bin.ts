#!/usr/bin/env node
import { createInterface } from "node:readline";

import { dispatch, type JsonRpcRequest, type JsonRpcResponse } from "./server.ts";

// Stdio MCP transport: stdout is reserved for newline-delimited JSON-RPC responses.
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
  if (Array.isArray(parsed)) {
    write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: JSON-RPC batching is not supported" } });
    return;
  }
  const response = dispatch(parsed as JsonRpcRequest);
  if (response) write(response);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", handleLine);
