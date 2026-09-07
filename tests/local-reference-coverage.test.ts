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

