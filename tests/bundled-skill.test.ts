import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(root, "skills", "navigating-with-codemap", "SKILL.md");

test("bundled navigation skill is harness-agnostic and CLI-first", () => {
  const source = readFileSync(skillPath, "utf8");

  assert.match(source, /^---\nname: navigating-with-codemap\ndescription: .+\n---\n/);
  const description = source.match(/^description: (.+)$/m)![1];
  for (const command of ["codemap status", "codemap search", "codemap context", "codemap index"]) {
    assert.match(source, new RegExp(command.replace(" ", "\\s+")), `missing ${command}`);
  }
  for (const fallback of ["grep", "rg", "ripgrep", "find", "fd", "glob"]) {
    assert.match(description, new RegExp(`\\b${fallback}\\b`, "i"), `frontmatter trigger does not name ${fallback}`);
  }
  assert.match(source, /literal(?: or |\/)regex match/);
  assert.match(source, /fall back/i);

  const harnessSpecific = [
    /\bCodex\b/i,
    /\bClaude\b/i,
    /\bCursor\b/i,
    /\bPi\b/,
    /\bMCP\b/,
    /AGENTS\.md/,
    /CLAUDE\.md/,
    /\.codex\//,
    /\.claude\//,
    /\.pi\//,
  ];
  for (const pattern of harnessSpecific) {
    assert.doesNotMatch(source, pattern, `skill contains harness-specific content: ${pattern}`);
  }
});

test("published package declares the bundled skill directory", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files?: string[] };
  assert.ok(pkg.files?.includes("skills/"));
});
