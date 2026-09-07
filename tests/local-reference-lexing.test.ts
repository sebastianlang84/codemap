import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";

useIsolatedHome("codemap-reference-lexing-");
import { extractLocalReferences } from "../src/core/local-references.ts";

const references = (text: string) => extractLocalReferences(text, "typescript", "src/main.ts");
const specifiers = (text: string) => references(text).map(reference => reference.specifier).sort();

test("JS references exclude comments and ordinary strings", () => {
  assert.deepEqual(specifiers(`
// import fake from './line-comment';
/* export { fake } from './block-comment'; */
const example = "require('./string-example')";
const another = 'import("./quoted-example")';
const template = \`import fake from './template-example'\`;
import real from './real';
`), ["./real"]);
});

test("JS references preserve declarations and executable template expressions", () => {
  assert.deepEqual(specifiers(`
import './side-effect';
import type { Value } from './types';
export { value } from './export';
export * from './star';
const a = require('./require');
const b = import('./dynamic');
const template = \`ignored require('./fake') \${import('./expression')} \${\`nested \${require('./nested')}\`}\`;
`), ["./dynamic", "./export", "./expression", "./nested", "./require", "./side-effect", "./star", "./types"]);
});

test("JS references skip regex literals and retain imports after division", () => {
  assert.deepEqual(specifiers(`
const pattern = /require('fake')/;
const quotePattern = /['\"]/;
const ratio = total / count;
const module = import('./real');
`), ["./real"]);
});

test("JS reference locations exclude leading comments and retain declaration spans", () => {
  assert.deepEqual(references(`// import fake from './fake';\nimport /* comment */ {\n value\n} from './real';`), [
    { kind: "import", specifier: "./real", lineStart: 2, lineEnd: 4 },
  ]);
});


test("index graph stores executable imports only", t => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src/core/real.ts"), "export const value = true;\n");
  writeFileSync(join(root, "src/core/fake.ts"), "export const value = false;\n");
  writeFileSync(join(root, "src/core/user-service.ts"), `
// import { value } from './fake';
const example = "require('./fake')";
import { value } from './real';
export const service = value;
`);
  indexRepo({ cwd: root });
  const db = new DatabaseSync(getRepoInfo(root).dbPath, { readOnly: true });
  try {
    const edges = db.prepare("select specifier from graph_edges where kind = 'imports' order by specifier").all();
    assert.deepEqual(edges.map(edge => edge.specifier), ["./real"]);
  } finally {
    db.close();
  }
});


test("JS reference clauses retain Unicode and quoted export names", () => {
  assert.deepEqual(specifiers(`
import { größe } from './unicode';
export { "name-with-dashes" as alias } from './quoted';
export const from = './unrelated';
const result = require /* explanatory comment */ ('./spaced');
`), ["./quoted", "./spaced", "./unicode"]);
});
