import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { extractSymbols } = await import("../src/core/symbols.ts");
const { loadIgnoreRules, shouldSkip } = await import("../src/core/ignore.ts");

function symbolNames(text: string): string[] {
  return extractSymbols(text, "typescript").map((symbol) => symbol.name);
}

test("extractSymbols captures default-exported and generator declarations", () => {
  assert.ok(symbolNames("export default function main() {}").includes("main"));
  assert.ok(symbolNames("export default class App {}").includes("App"));
  assert.ok(symbolNames("export default async function boot() {}").includes("boot"));
  assert.ok(symbolNames("function* generate() {}").includes("generate"));
});

test("extractSymbols does not treat catch/return control lines as methods", () => {
  const names = symbolNames("  catch (err) {\n  return err;\n");
  assert.ok(!names.includes("catch"), "catch (…) { is not a symbol");
  assert.ok(!names.includes("return"), "return (…) is not a symbol");
});

test("gitignore negations re-include files and * does not cross /", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-codemap-ignore-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, ".gitignore"), "*.log\n!keep.log\nlogs/*\n");
  const rules = loadIgnoreRules(dir);

  assert.equal(shouldSkip("app.log", false, rules), ".gitignore", "*.log is ignored");
  assert.equal(shouldSkip("keep.log", false, rules), undefined, "!keep.log re-includes it");
  assert.equal(shouldSkip("logs/out.txt", false, rules), ".gitignore", "logs/* matches a direct child");
  assert.equal(shouldSkip("logs/sub/out.txt", false, rules), undefined, "* in logs/* does not cross a slash");
});

test("gitignore directory globs exclude generated trees at every depth", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-codemap-ignore-dir-glob-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, ".gitignore"), "**/*.egg-info/\n*.cache-dir/\n");
  const rules = loadIgnoreRules(dir);

  assert.equal(shouldSkip("package.egg-info", true, rules), ".gitignore");
  assert.equal(shouldSkip("services/package.egg-info", true, rules), ".gitignore");
  assert.equal(
    shouldSkip("services/package.egg-info/SOURCES.txt", false, rules),
    ".gitignore",
  );
  assert.equal(shouldSkip("services/package.cache-dir", true, rules), ".gitignore");
  assert.equal(
    shouldSkip("services/package.cache-dir/metadata.json", false, rules),
    ".gitignore",
  );
});

test("anchored gitignore patterns only match at their own level", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-codemap-ignore-anchored-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, ".gitignore"), "/fixtures\n/out/\n/*.log\nfixed/name\n");
  const rules = loadIgnoreRules(dir);

  assert.equal(shouldSkip("fixtures", true, rules), ".gitignore");
  assert.equal(shouldSkip("packages/a/fixtures", true, rules), undefined, "/fixtures is anchored to the root");
  assert.equal(shouldSkip("out", true, rules), ".gitignore");
  assert.equal(shouldSkip("packages/out", true, rules), undefined, "/out/ is anchored to the root");
  assert.equal(shouldSkip("app.log", false, rules), ".gitignore");
  assert.equal(shouldSkip("sub/app.log", false, rules), undefined, "/*.log is anchored to the root");
  assert.equal(shouldSkip("fixed/name", true, rules), ".gitignore");
  assert.equal(shouldSkip("sub/name", true, rules), undefined, "a middle slash anchors too");
});

test("multi-segment built-in directories are skipped", () => {
  const rules = { gitignore: [], codemapignore: [] };
  assert.equal(shouldSkip(".pi/npm", true, rules), "ignored directory");
  assert.equal(shouldSkip(".pi/npm/pkg/index.ts", false, rules), "ignored directory");
  assert.equal(shouldSkip("tools/.pi/git/x.ts", false, rules), "ignored directory");
  assert.equal(shouldSkip(".pi/extensions/x.ts", false, rules), undefined);
});
