#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
let packInfo;

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`✗ ${name}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function npmPackInfo() {
  if (!packInfo) packInfo = JSON.parse(run("npm", ["pack", "--dry-run", "--json"]))[0];
  return packInfo;
}

function forbiddenLocalArtifact(file) {
  return /(^|\/)\.env($|\.)|\.sqlite(?:-wal|-shm)?$|private[-_]?key|secret/i.test(file);
}

check("no runtime dependencies", () => {
  const pkg = JSON.parse(run("node", ["-e", "console.log(require('./package.json').dependencies ? JSON.stringify(require('./package.json').dependencies) : '{}')"]));
  if (Object.keys(pkg).length > 0) throw new Error(`dependencies present: ${Object.keys(pkg).join(", ")}`);
});

check("Pi extension entry exists", () => {
  const pkg = JSON.parse(run("node", ["-e", "console.log(JSON.stringify(require('./package.json').pi?.extensions ?? []))"]));
  for (const entry of pkg) {
    const path = join(root, entry);
    if (!existsSync(path)) throw new Error(`missing extension entry ${entry}`);
  }
});

check("tracked files do not include local indexes, env files, or obvious private keys", () => {
  const files = run("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
  const forbidden = files.filter(forbiddenLocalArtifact);
  if (forbidden.length > 0) throw new Error(forbidden.join(", "));
});

check("package contents do not include local indexes, env files, or obvious private keys", () => {
  const files = (npmPackInfo().files ?? []).map((file) => file.path).filter(Boolean);
  const forbidden = files.filter(forbiddenLocalArtifact);
  if (forbidden.length > 0) throw new Error(forbidden.join(", "));
});

check("package tarball stays small", () => {
  const pack = npmPackInfo();
  const unpackedSize = Number(pack?.unpackedSize ?? 0);
  const limit = 250_000;
  if (unpackedSize > limit) throw new Error(`unpackedSize ${unpackedSize} exceeds ${limit}`);
});

check("typecheck", () => {
  run("npm", ["run", "typecheck", "--", "--pretty", "false"]);
});

check("tests", () => {
  run("npm", ["test"]);
});

if (failures.length > 0) {
  console.error("\nLightweight audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nLightweight audit passed.");
