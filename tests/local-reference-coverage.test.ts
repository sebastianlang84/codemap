import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";
import { extractLocalReferences } from "../src/core/local-references.ts";

useIsolatedHome("codemap-reference-coverage-");

function write(root: string, path: string, text = "export interface Value {}\n") {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}
function targets(root: string, source: string): string[] {
  const db = new DatabaseSync(getRepoInfo(root).dbPath, { readOnly: true });
  try {
    return db.prepare(`select target.path from graph_edges e join graph_nodes source on source.id=e.from_node_id
      join graph_nodes target on target.id=e.to_node_id where source.path=? order by target.path`).all(source).map(row => String(row.path));
  } finally { db.close(); }
}

test("declaration fallback resolves extensionless and JS imports without guessing between declarations", t => {
  const root = fixtureRepo(t);
  write(root, "src/consumer.ts", `import type { A } from './types';\nimport type { B } from './decl.js';\nimport type { C } from './ambiguous';\nimport type { D } from './runtime';\n`);
  for (const path of ["src/types.d.ts", "src/decl.d.ts", "src/ambiguous.d.ts", "src/ambiguous/index.d.ts", "src/runtime.ts", "src/runtime.d.ts"]) write(root, path);
  indexRepo({ cwd: root });
  assert.deepEqual(targets(root, "src/consumer.ts"), ["src/decl.d.ts", "src/runtime.ts", "src/types.d.ts"]);
});

test("absolute Python imports resolve unique root and src modules, skipping external and ambiguous targets", t => {
  const root = fixtureRepo(t);
  write(root, "scripts/main.py", "import root_module as local, external_lib\nfrom mypackage.worker import run\nimport ambiguous\nimport conflict\n");
  for (const path of ["root_module.py", "src/mypackage/worker.py", "ambiguous.py", "src/ambiguous.py", "conflict.py", "conflict/__init__.py"]) write(root, path, "value = 1\n");
  indexRepo({ cwd: root });
  assert.deepEqual(targets(root, "scripts/main.py"), ["root_module.py", "src/mypackage/worker.py"]);
});

test("Python imports exclude documentation and retain exact source lines", () => {
  const text = '# import fake\n"""\nimport documentation\n"""\nfrom package.worker import run\nimport first as alias, second.submodule\n';
  assert.deepEqual(extractLocalReferences(text, "python", "main.py"), [
    { kind: "import", specifier: "package/worker", lineStart: 5, lineEnd: 5 },
    { kind: "import", specifier: "first", lineStart: 6, lineEnd: 6 },
    { kind: "import", specifier: "second/submodule", lineStart: 6, lineEnd: 6 },
  ]);
});

