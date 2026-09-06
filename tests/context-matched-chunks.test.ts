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
