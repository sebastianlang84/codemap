import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");

test("search limits only truncate one stable ranking", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "ranking"), { recursive: true });
  for (let index = 0; index < 12; index++) {
    writeFileSync(join(root, "ranking", `candidate-${String(index).padStart(2, "0")}.ts`), `export function searchRanking${index}() { return "search ranking ${index}"; }\n`);
  }
  indexRepo({ cwd: root });
  const wide = searchCodeMap({ cwd: root, query: "search ranking", limit: 50 });
  assert.ok(wide.length >= 10, "fixture query must exercise a ranking wider than every tested limit");

  for (const limit of [1, 3, 5, 10]) {
    assert.deepEqual(searchCodeMap({ cwd: root, query: "search ranking", limit }), wide.slice(0, limit));
  }
});
