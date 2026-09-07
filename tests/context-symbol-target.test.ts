import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { codemapContext } from "../src/core/context.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

test("exact symbols beat partial filenames while exact paths and scope remain authoritative", t => {
  const root = fixtureRepo(t);
  const body = "res.deliver = function(body) {\n  return body;\n};";
  writeFileSync(join(root, "src/core/response.js"), body);
  writeFileSync(join(root, "src/core/res.deliver.test.js"), "// similarly named test file\n");
  writeFileSync(join(root, "docs/deliver.md"), "# Delivery notes\n");
  indexRepo({ cwd: root });
  for (const target of ["res.deliver", "deliver"]) {
    const result = codemapContext({ cwd: root, target, limit: 1 });
    assert.equal(result.targetForm, "query");
    assert.equal(result.readFirst[0]?.path, "src/core/response.js");
    assert.equal("text" in result.readFirst[0]! && result.readFirst[0].text, body);
  }
  assert.equal(codemapContext({ cwd: root, target: "src/core/res.deliver.test.js", limit: 1 }).targetForm, "path");
  assert.equal(codemapContext({ cwd: root, target: "deliver", pathPrefix: "docs/", limit: 1 }).readFirst[0]?.path, "docs/deliver.md");
  writeFileSync(join(root, "res.js"), "// Exact file wins.\n");
  writeFileSync(join(root, "src/core/response.js"), `${body}\nres.js = function() {};\n`);
  indexRepo({ cwd: root });
  const direct = codemapContext({ cwd: root, target: "res.js", limit: 1 });
  assert.equal(direct.targetForm, "path");
  assert.equal(direct.readFirst[0]?.path, "res.js");
});
