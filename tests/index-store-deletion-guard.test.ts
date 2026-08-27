import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { DatabaseSync } from "node:sqlite";

const { openRepoDb } = await import("../src/core/db.ts");
const { applyIndexUpdate } = await import("../src/core/index-store.ts");
const { scanRepo } = await import("../src/core/scanner.ts");

function scannedFile(relPath: string, text: string) {
  return {
    absPath: `/virtual/${relPath}`,
    relPath,
    language: "typescript",
    size: text.length,
    mtimeMs: 1,
    hash: `hash-${relPath}-${text.length}`,
    text,
  };
}

function countFiles(db: DatabaseSync): number {
  return (db.prepare("select count(*) as n from files").get() as { n: number }).n;
}

test("an incomplete scan never prunes previously-indexed files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-codemap-deletion-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openRepoDb(join(dir, "repo.sqlite"));
  t.after(() => db.close());

  const fileA = scannedFile("src/a.ts", "export const a = 1;");
  const fileB = scannedFile("src/b.ts", "export const b = 2;");
  const first = applyIndexUpdate({ db, files: [fileA, fileB], pathPrefix: "", indexedHead: null });
  assert.equal(first.indexed, 2);
  assert.equal(countFiles(db), 2);

  // Simulate a partial/aborted scan that did not visit file B (e.g. an unreadable directory or a
  // mid-scan I/O error). With allowDeletions:false the missing file must be preserved, not pruned.
  const guarded = applyIndexUpdate({ db, files: [fileA], pathPrefix: "", indexedHead: null, allowDeletions: false });
  assert.equal(guarded.removed, 0);
  assert.equal(countFiles(db), 2, "B is preserved when the scan was incomplete");

  // A complete scan that genuinely no longer sees B prunes it as usual.
  const complete = applyIndexUpdate({ db, files: [fileA], pathPrefix: "", indexedHead: null, allowDeletions: true });
  assert.equal(complete.removed, 1);
  assert.equal(countFiles(db), 1, "B is pruned when the scan completed");
});

test("scanRepo flags an out-of-repo pathPrefix as incomplete", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-codemap-scan-incomplete-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = scanRepo(dir, { pathPrefix: "../outside" });
  assert.equal(result.incomplete, true);
  assert.equal(result.files.length, 0);
});

test("scanRepo accepts an in-repo pathPrefix and scans only that subtree", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-codemap-scan-scoped-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "root.ts"), "export const outside = 1;\n");

  const result = scanRepo(dir, { pathPrefix: "src" });

  // The rejection case above had no accepting counterpart, which is how a Windows-only defect
  // survived: the check compared `resolve()` output (backslashes there) against a `/`-joined prefix,
  // so every valid prefix was rejected as "outside repository" and the scan yielded nothing.
  assert.deepEqual(result.warnings, [], "a valid prefix produces no warning");
  assert.equal(result.incomplete, false);
  assert.deepEqual(result.files.map((file) => file.relPath), ["src/a.ts"]);
});
