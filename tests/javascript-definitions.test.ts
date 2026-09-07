import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { chunkText, functionChunkAtLine } from "../src/core/chunker.ts";
import { codemapContext } from "../src/core/context.ts";
import { openRepoDb } from "../src/core/db.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { INDEX_VERSION } from "../src/core/index-store.ts";
import { searchCodeMap } from "../src/core/search.ts";
import { extractSymbols } from "../src/core/symbols.ts";
import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

test("function assignments expose the assigned name and its short property alias", () => {
  const cases: Array<[string, string[]]> = [
    ["res.send = function send(body) {", ["res.send", "send"]],
    ["res.send = function(body) {", ["res.send", "send"]],
    ["res.send = function internalSend(body) {", ["res.send", "send"]],
    ["module.exports.send = async function(body) {", ["module.exports.send", "send"]],
    ["res.send = function* send(body) {", ["res.send", "send"]],
    ["const send = function(body) {", ["send"]],
    ["let send = function named(body) {", ["send"]],
    ["var send = function (body) {", ["send"]],
  ];
  for (const language of ["javascript", "typescript"]) {
    for (const [source, expected] of cases) {
      const symbols = extractSymbols(`\n${source}`, language);
      assert.deepEqual(symbols.map(symbol => symbol.name), expected, source);
      assert.ok(symbols.every(symbol => symbol.kind === "function" && symbol.startLine === 2 && symbol.signature === source));
    }
  }
  assert.deepEqual(extractSymbols(cases[0]![0], "python"), []);
});

test("callback calls are not method definitions, while real parameter lists remain supported", () => {
  for (const source of [
    "sendfile(res, file, opts, function (err) {",
    "sendfile(res, file, opts, (err) => {",
    "sendfile(res, function (err) {});",
    "sendfile(value => ({ value }));",
    "res.send = wrap(function send(body) {",
    "res.send = functionality(body);",
    "if (ready) {", "catch (error) {",
  ]) assert.deepEqual(extractSymbols(source, "javascript"), [], source);
  for (const source of [
    "run(value) {", "public run(value: Input): Output {",
    "run({ value } = {}, fallback = makeDefault()) {",
    "run(callback = function () {}) {", "run(callback = () => true) {",
    'run(value = ")") {', "run(value = /[)]/) {",
    "run(value /* ) */) {", "run(value = 12 / (4 + 2)) {",
  ]) assert.deepEqual(extractSymbols(source, "typescript").map(symbol => [symbol.name, symbol.kind]), [["run", "method"]], source);
});

test("assigned function chunks retain the whole body and exclude the next declaration", () => {
  const body = 'res.send = function send(body) {\n  const literal = "}";\n  return body;\n};';
  const source = `// header\n${body}\nfunction next() {}\n`;
  assert.equal(chunkText(source, "javascript").find(chunk => chunk.startLine === 2)?.text, body);
  assert.equal(functionChunkAtLine(source, "javascript", 2)?.text, body);
  assert.equal(functionChunkAtLine('res.send = function(body) {\n  return body;', "javascript", 1), undefined);
});

test("assigned functions are searchable by full and short names with complete nested context", t => {
  const root = fixtureRepo(t);
  const path = "src/core/response.js";
  const body = "  res.deliverPayload = function internalDeliver(body) {\n    return body;\n  };";
  writeFileSync(join(root, path), `function createResponse() {\n${body}\n  return res;\n}\n`);
  indexRepo({ cwd: root });
  for (const query of ["res.deliverPayload", "deliverPayload"]) {
    const hit = searchCodeMap({ cwd: root, query })[0]!;
    assert.equal(hit.path, path, query);
    assert.equal(hit.startLine, 2, query);
    const item = codemapContext({ cwd: root, target: query, limit: 1 }).readFirst[0]!;
    assert.equal(item.path, path);
    assert.equal(item.startLine, 2);
    assert.equal(item.endLine, 4);
    assert.ok("text" in item && item.text === body, JSON.stringify(item));
  }
});

test("index refresh replaces old symbols even when file timestamps and contents are unchanged", t => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src/core/assigned.js"), "res.deliverPayload = function(body) { return body; };\n");
  const indexed = indexRepo({ cwd: root });
  let db = openRepoDb(indexed.dbPath);
  db.prepare("update meta set value='8' where key='index_version'").run();
  db.exec("delete from symbols_fts; delete from symbols;");
  db.close();
  assert.notEqual(INDEX_VERSION, "8");
  indexRepo({ cwd: root });
  db = openRepoDb(indexed.dbPath);
  try {
    assert.ok(db.prepare("select 1 from symbols where name='res.deliverPayload'").get());
    assert.equal((db.prepare("select value from meta where key='index_version'").get() as { value: string }).value, INDEX_VERSION);
  } finally { db.close(); }
});
