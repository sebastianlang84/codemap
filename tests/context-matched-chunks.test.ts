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
