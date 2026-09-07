import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { codemapContext } from "../src/core/context.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

test("context lists and selects importing tests even when filenames differ", t => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "test/internals"), { recursive: true });
  writeFileSync(join(root, "src/core/check-utils.js"), [
    "const a = require('./prerequisite.js');",
    "const b = require('./condition.js');",
    "function check(value) { return a(value) && b(value); }",
  ].join("\n"));
  for (const name of ["prerequisite", "condition"]) writeFileSync(join(root, `src/core/${name}.js`), "module.exports = value => Boolean(value);\n");
  writeFileSync(join(root, "test/internals/dependencies.test.js"), "const { check } = require('../../src/core/check-utils.js');\ncheck('ok');\n");
  writeFileSync(join(root, "test/unrelated.test.js"), "const a = require('../src/core/prerequisite.js');\n");
  writeFileSync(join(root, "test/check-utils.test.js"), "// Existing filename convention remains available.\n");
  indexRepo({ cwd: root });

  const single = codemapContext({ cwd: root, target: "src/core/check-utils.js:3", limit: 1 });
  assert.equal(single.readFirst.length, 1);
  assert.equal(single.readFirst[0]?.startLine, 3);
  assert.deepEqual(single.relatedTests, ["test/internals/dependencies.test.js", "test/check-utils.test.js"]);

  const expanded = codemapContext({ cwd: root, target: "src/core/check-utils.js:3", limit: 4 });
  const directTest = expanded.readFirst.find(item => item.path === "test/internals/dependencies.test.js");
  assert.ok(directTest);
  assert.ok(directTest.reasons?.some(reason => reason.kind === "reverse_test"));
  assert.ok(!directTest.reasons?.some(reason => reason.kind === "sibling_test"));

  const scoped = codemapContext({ cwd: root, target: "src/core/check-utils.js:3", pathPrefix: "src/core", limit: 8 });
  assert.deepEqual(scoped.relatedTests, []);
  assert.ok(scoped.readFirst.every(item => item.path.startsWith("src/core/")));
});
