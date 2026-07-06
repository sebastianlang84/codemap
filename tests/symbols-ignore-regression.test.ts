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
