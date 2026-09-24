import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { codemapContext } from "../src/core/context.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { searchCodeMap } from "../src/core/search.ts";
import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

test("query context retains the matched function body beyond the file header", (t) => {
  const root = fixtureRepo(t);
  const path = "src/core/ledger.ts";
  const header = Array.from({ length: 90 }, (_, i) => `// introductory line ${i}`).join("\n");
  const body = "export function reconcileLedger() {\n  return 8675309;\n}";
  writeFileSync(join(root, path), `${header}\n${body}\n`);
  indexRepo({ cwd: root });

  const hit = searchCodeMap({ cwd: root, query: "reconcileLedger" })[0]!;
  assert.equal(hit.path, path);
  assert.equal(hit.startLine, 91);
  for (const limit of [1, 4, 8]) {
    const context = codemapContext({ cwd: root, target: "reconcileLedger", limit });
    const item = context.readFirst[0]!;
    assert.equal(item.path, path);
    assert.ok(item.startLine <= 91 && item.endLine >= 93, JSON.stringify(item));
    assert.ok("text" in item && item.text.includes(body), JSON.stringify(item));
    assert.ok(item.reasons?.some((reason) => reason.kind === "target"));
    assert.ok(context.readFirst.length <= limit);
  }

  const direct = codemapContext({ cwd: root, target: path, limit: 1 });
  assert.equal(direct.readFirst[0]?.startLine, 1);
});

test("query context retains matched neighbor code and its relationship reasons", (t) => {
  const root = fixtureRepo(t);
  const header = Array.from({ length: 90 }, (_, i) => `// introductory line ${i}`).join("\n");
  for (const name of ["alpha", "beta"]) {
    const imports = name === "alpha" ? 'import "./beta";\n' : "";
    writeFileSync(join(root, "src/core", `${name}.ts`),
      `${imports}${header}\nexport function settlePayment() {\n  return "${name}";\n}\n`);
  }
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "settlePayment", limit: 4, pathPrefix: "src/core/" });
  for (const name of ["alpha", "beta"]) {
    const item = result.readFirst.find((item) => item.path === `src/core/${name}.ts`);
    assert.ok(item && "text" in item && item.text.includes(`return "${name}";`), JSON.stringify(item));
    assert.ok(item.reasons?.some((reason) => reason.kind === "search_result"));
  }
  assert.ok(result.readFirst.every((item) => item.path.startsWith("src/core/")));
  assert.ok(result.readFirst.some((item) => item.reasons?.some((reason) =>
    reason.kind === "import" || reason.kind === "reverse_import")));
});

test("nested function context excludes its enclosing factory while preserving the full body", (t) => {
  const root = fixtureRepo(t);
  const prefix = ['export function createServer() {', ...Array.from({ length: 90 }, (_, i) => `  // setup ${i}`)];
  const body = [
    '  function addHttpMethod(method, { hasBody = false } = {}) {',
    '    const literal = "}";',
    '    if (hasBody) { return { method, literal }; }',
    '    return method;',
    '  }',
  ].join('\n');
  writeFileSync(join(root, "src/core/server.ts"), `${prefix.join('\n')}\n${body}\n  return addHttpMethod;\n}\n`);
  indexRepo({ cwd: root });
  const result = codemapContext({ cwd: root, target: 'addHttpMethod' });
  const item = result.readFirst.find(item => item.path === 'src/core/server.ts');
  assert.ok(item && 'text' in item);
  assert.equal(item.startLine, 92);
  assert.equal(item.endLine, 96);
  assert.equal(item.text, body);
  assert.ok(item.reasons?.some(reason => reason.kind === 'search_result'));
  const parent = codemapContext({ cwd: root, target: 'createServer' }).readFirst[0];
  assert.ok(parent && 'text' in parent && parent.text.includes('return addHttpMethod;'));
});

test("nested Python function context keeps its body without the enclosing function", (t) => {
  const root = fixtureRepo(t);
  const body = '    def send_delivery(message):\n        result = message.strip()\n        return result';
  writeFileSync(join(root, 'src/core/nested.py'), `def create_delivery():\n    client = None\n${body}\n    return send_delivery\n`);
  indexRepo({ cwd: root });
  const item = codemapContext({ cwd: root, target: 'send_delivery' }).readFirst[0];
  assert.ok(item && 'text' in item);
  assert.equal(item.startLine, 3);
  assert.equal(item.endLine, 5);
  assert.equal(item.text, body);
});

test("function refinement falls back for unsupported or incomplete declarations", async () => {
  const { functionChunkAtLine } = await import('../src/core/chunker.ts');
  assert.equal(functionChunkAtLine('function broken() {\n  return 1;', 'javascript', 1), undefined);
  assert.equal(functionChunkAtLine('fn example() {}', 'rust', 1), undefined);
  assert.equal(functionChunkAtLine('const value = 1;', 'javascript', 1), undefined);
  assert.equal(functionChunkAtLine('function complete() {}', 'javascript', 0), undefined);
});

test("context accepts a search location beyond the header and rejects unavailable ranges", (t) => {
  const root = fixtureRepo(t);
  const path = "src/core/ledger.ts";
  const header = Array.from({ length: 100 }, () => "// introduction").join("\n");
  const body = "export function preserveLocation() {\n  return 'selected body';\n}";
  writeFileSync(join(root, path), `${header}\n${body}\n`);
  indexRepo({ cwd: root });
  const hit = searchCodeMap({ cwd: root, query: "preserveLocation" })[0]!;
  for (const location of [`${path}:${hit.startLine}`, `${path}:${hit.startLine}-${hit.endLine}`]) {
    const result = codemapContext({ cwd: root, target: location, limit: 1 });
    assert.equal(result.targetForm, "path");
    assert.equal(result.contextTarget, path);
    assert.equal(result.readFirst.length, 1);
    assert.ok("text" in result.readFirst[0]! && result.readFirst[0].text.includes(body));
  }
  for (const suffix of ["0", "103-101", "9999", "9007199254740992"]) {
    assert.throws(() => codemapContext({ cwd: root, target: `${path}:${suffix}` }));
  }
  assert.throws(() => codemapContext({ cwd: root, target: `${path}:101`, pathPrefix: "other/" }));
  assert.throws(() => codemapContext({ cwd: root, target: "missing.ts:101" }));
  assert.equal(codemapContext({ cwd: root, target: path, limit: 1 }).readFirst[0]?.startLine, 1);
});


test("literal colon-number filenames take precedence over location parsing", (t) => {
  const root = fixtureRepo(t);
  const path = "src/core/note:42.md";
  writeFileSync(join(root, path), "# Literal file\nSelected literal filename.\n");
  indexRepo({ cwd: root });
  const result = codemapContext({ cwd: root, target: path, limit: 1 });
  assert.equal(result.contextTarget, path);
});

test("location context stays bounded inside large classes and spans several chunks", (t) => {
  const root = fixtureRepo(t);
  const path = "src/core/app.py";
  const methods = Array.from({ length: 60 }, (_, i) =>
    `    def method_${i}(self):\n        value = ${i}\n        return value\n`).join("\n");
  writeFileSync(join(root, path), `class App:\n    name = "app"\n\n${methods}\n\ndef helper():\n    return 1\n`);
  const tsPath = "src/core/pair.ts";
  writeFileSync(join(root, tsPath), "export function first() {\n  return 1;\n}\nexport function second() {\n  return 2;\n}\n");
  indexRepo({ cwd: root });

  // Line 4 is `def method_0`; lines 5-6 are its body inside a class chunk of ~240 lines.
  const method = codemapContext({ cwd: root, target: `${path}:5-6`, limit: 1 }).readFirst[0]!;
  assert.ok("text" in method);
  assert.deepEqual([method.startLine, method.endLine, method.kind], [4, 6, "function"]);
  assert.ok(method.text.startsWith("    def method_0(self):"));

  const attribute = codemapContext({ cwd: root, target: `${path}:2`, limit: 1 }).readFirst[0]!;
  assert.ok("text" in attribute);
  assert.deepEqual([attribute.startLine, attribute.endLine, attribute.kind], [2, 81, "text"]);

  const across = codemapContext({ cwd: root, target: `${tsPath}:2-5`, limit: 1 }).readFirst[0]!;
  assert.ok("text" in across && across.text.includes("return 1;") && across.text.includes("return 2;"));
  assert.equal(across.startLine, 2);
  const clamped = codemapContext({ cwd: root, target: `${tsPath}:4-99`, limit: 1 }).readFirst[0]!;
  assert.ok("text" in clamped && clamped.startLine === 4 && clamped.text.includes("return 2;"));
  assert.throws(() => codemapContext({ cwd: root, target: `${tsPath}:99` }));
});

test("location context skips functions inside strings and stays fast in long classes", (t) => {
  const root = fixtureRepo(t);
  const path = "src/core/big.py";
  const filler = Array.from({ length: 6000 }, (_, i) => `    attribute_${i} = ${i}`).join("\n");
  const source = `class Big:\n    note = """\n    def fake():\n        payload\n    """\n${filler}\n`;
  writeFileSync(join(root, path), source);
  indexRepo({ cwd: root });
  const lines = source.split("\n");
  const check = (target: string, start: number) => {
    const item = codemapContext({ cwd: root, target, limit: 1 }).readFirst[0]!;
    assert.ok("text" in item);
    assert.equal(item.kind, "text");
    assert.equal(item.startLine, start);
    assert.equal(item.text, lines.slice(item.startLine - 1, item.endLine).join("\n"));
  };
  check(`${path}:4`, 4);
  const began = performance.now();
  check(`${path}:6000`, 6000);
  assert.ok(performance.now() - began < 1000, `slow location lookup: ${performance.now() - began} ms`);
});

test("location context skips functions inside template strings", (t) => {
  const root = fixtureRepo(t);
  const path = "src/core/big.ts";
  const members = Array.from({ length: 200 }, (_, i) => `  field${i} = ${i};`).join("\n");
  const source = `export class Big {\n  template = \`\nfunction fake() {\n  payload\n}\n\`;\n${members}\n}\n`;
  writeFileSync(join(root, path), source);
  indexRepo({ cwd: root });
  const item = codemapContext({ cwd: root, target: `${path}:5`, limit: 1 }).readFirst[0]!;
  assert.ok("text" in item);
  assert.equal(item.kind, "text");
  assert.equal(item.text, source.split("\n").slice(item.startLine - 1, item.endLine).join("\n"));
});
