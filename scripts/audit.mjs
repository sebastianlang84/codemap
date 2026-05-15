#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

check("runtime dependencies stay explicit and minimal", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencies = Object.keys(pkg.dependencies ?? {}).sort();
  const allowed = ["typebox"];
  const unexpected = dependencies.filter((name) => !allowed.includes(name));
  if (unexpected.length > 0) throw new Error(`unexpected dependencies: ${unexpected.join(", ")}`);
  for (const name of allowed) {
    if (!dependencies.includes(name)) throw new Error(`missing runtime dependency: ${name}`);
  }
});

check("Pi extension entries exist and import", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entries = pkg.pi?.extensions ?? [];
  for (const entry of entries) {
    const path = join(root, entry);
    if (!existsSync(path)) throw new Error(`missing extension entry ${entry}`);
    run(process.execPath, ["--experimental-strip-types", "-e", `await import(${JSON.stringify(pathToFileURL(path).href)})`]);
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
  const limit = 275_000;
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
