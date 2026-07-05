import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { dispatch, mcpTools } = await import("../src/mcp/server.ts");

test("initialize negotiates protocol and advertises the codemap server", () => {
  const response = dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.ok(response);
  assert.equal(response.id, 1);
  const result = response.result as { protocolVersion: string; serverInfo: { name: string; description?: string }; capabilities: Record<string, unknown>; instructions?: string };
  assert.equal(result.protocolVersion, "2025-06-18", "echoes a supported requested version");
  assert.equal(result.serverInfo.name, "codemap");
  assert.equal(typeof result.serverInfo.description, "string");
  assert.match(result.instructions ?? "", /codemap_search/, "surfaces usage guidance via instructions");
  assert.ok("tools" in result.capabilities, "advertises tools capability");
});

test("initialize advertises the current protocol when the client omits or requests an unsupported version", () => {
  assert.equal((dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })!.result as { protocolVersion: string }).protocolVersion, "2025-11-25");
  const unsupported = dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "banana-9999" } });
  assert.equal((unsupported!.result as { protocolVersion: string }).protocolVersion, "2025-11-25", "falls back to a version we implement");
});

test("notifications receive no response regardless of method", () => {
  assert.equal(dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(dispatch({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }), null);
  // A known method sent without an id is still a notification and must not be answered.
  assert.equal(dispatch({ jsonrpc: "2.0", method: "tools/list" }), null);
});

test("id 0 is preserved and echoed, not coerced to null", () => {
  assert.equal(dispatch({ jsonrpc: "2.0", id: 0, method: "ping" })!.id, 0);
});

test("tools/list exposes the four codemap tools with JSON Schema inputs", () => {
  const response = dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (response!.result as { tools: Array<{ name: string; description: string; inputSchema: any; annotations: any }> }).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["codemap_context", "codemap_index", "codemap_search", "codemap_status"],
  );
  for (const tool of tools) {
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object", `${tool.name} advertises an object input schema`);
  }
  const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name).sort();
  assert.deepEqual(readOnly, ["codemap_context", "codemap_search", "codemap_status"], "read-only tools carry readOnlyHint");
  assert.equal(tools.find((tool) => tool.name === "codemap_index")!.annotations.readOnlyHint, false);
  assert.equal(mcpTools.length, 4);
});

test("tools/call runs codemap_search against the target repo", (t) => {
  const root = fixtureRepo(t);
  const response = dispatch(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "codemap_search", arguments: { query: "approveUser", limit: 5 } } },
    { cwd: root },
  );
  const result = response!.result as { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: { results?: Array<{ path: string }> } };
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0]?.type, "text");
  // Text stays compact (ranked path:line list), not a duplicated JSON dump.
  assert.match(result.content[0]!.text, /src\/core\/user-service\.ts:\d+-\d+ \[/);
  assert.doesNotMatch(result.content[0]!.text, /"results":/, "text is not a JSON blob");
  // Full structured object stays available once for hosts that parse it.
  assert.ok(result.structuredContent?.results?.some((row) => row.path === "src/core/user-service.ts"), result.content[0]?.text);
});

test("tools/call reports tool failures in-band with isError", (t) => {
  const root = fixtureRepo(t);
  const response = dispatch(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "codemap_status", arguments: { repoPath: "does/not/exist" } } },
    { cwd: root },
  );
  const result = response!.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /does not exist/);
});

test("missing or mistyped required arguments return an actionable tool error", () => {
  const missing = dispatch({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "codemap_search", arguments: {} } });
  const missingResult = missing!.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(missingResult.isError, true);
  assert.match(missingResult.content[0]!.text, /Missing required argument: query/);

  const mistyped = dispatch({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "codemap_context", arguments: { target: 5 } } });
  const mistypedResult = mistyped!.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(mistypedResult.isError, true);
  assert.match(mistypedResult.content[0]!.text, /target must be of type string/);
});

test("unknown tool is a self-correctable tool error, unknown method is a protocol error", () => {
  // SEP-1303: an unknown tool name comes back as an isError result (not a JSON-RPC error) so the
  // model can read the message, see the valid names, and retry.
  const unknownTool = dispatch({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "codemap_teleport", arguments: {} } });
  assert.equal(unknownTool!.error, undefined);
  const toolResult = unknownTool!.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(toolResult.isError, true);
  assert.match(toolResult.content[0]!.text, /codemap_teleport/);
  assert.match(toolResult.content[0]!.text, /codemap_search/, "lists the available tools");

  // An unknown JSON-RPC method is a genuine protocol error.
  const unknownMethod = dispatch({ jsonrpc: "2.0", id: 6, method: "resources/list" });
  assert.equal(unknownMethod!.error?.code, -32601);
});
