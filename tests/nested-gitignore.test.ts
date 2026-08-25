import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo, status } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");

test("nested .gitignore rules keep ignored files out of the index and honor local negations", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codemap-nested-gitignore-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "packages", "api"), { recursive: true });
  writeFileSync(join(root, "packages", "api", ".gitignore"), "*.json\n!public.json\n");
  writeFileSync(join(root, "packages", "api", "credentials.json"), '{"private_key":"serviceAccountNeedle"}\n');
  writeFileSync(join(root, "packages", "api", "public.json"), '{"name":"publicConfigNeedle"}\n');

  indexRepo({ cwd: root, approve: true });

  assert.deepEqual(searchCodeMap({ cwd: root, query: "serviceAccountNeedle" }), []);
  assert.equal(searchCodeMap({ cwd: root, query: "publicConfigNeedle" })[0]?.path, "packages/api/public.json");
  assert.equal(status(root, { health: "full" }).files, 1);
});
