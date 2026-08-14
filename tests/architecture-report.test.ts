import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { buildArchitectureReport } = await import("../src/core/architecture-report.ts");
const { openRepoDb } = await import("../src/core/db.ts");
const { indexRepo } = await import("../src/core/indexer.ts");
const { getRepoInfo } = await import("../src/core/repo.ts");

test("architecture report summarizes graph hotspots, cycles, weak files, and clusters deterministically", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "core"), { recursive: true });
  mkdirSync(join(root, "src", "feature"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "src", "operation.ts"), "import { runCore } from './core/index';\nexport const operation = runCore;\n");
  writeFileSync(join(root, "src", "core", "index.ts"), "import { readStore } from './store';\nexport const runCore = readStore;\n");
  writeFileSync(join(root, "src", "core", "store.ts"), "export function readStore() { return true; }\n");
  writeFileSync(join(root, "src", "feature", "cycle-a.ts"), "import { cycleB } from './cycle-b';\nexport const cycleA = cycleB;\n");
  writeFileSync(join(root, "src", "feature", "cycle-b.ts"), "import { cycleA } from './cycle-a';\nexport const cycleB = cycleA;\n");
  writeFileSync(join(root, "src", "isolated.ts"), "export const isolated = true;\n");
  writeFileSync(join(root, "docs", "overview.md"), "# Overview\n");
  indexRepo({ cwd: root });

  const db = openRepoDb(getRepoInfo(root).dbPath);
  try {
    const report = buildArchitectureReport(db, "%", { limit: 10 });

    assert.deepEqual(report.highDegreeFiles.slice(0, 3).map((item) => [item.path, item.inbound, item.outbound, item.total]), [
      ["src/core/index.ts", 1, 1, 2],
      ["src/feature/cycle-a.ts", 1, 1, 2],
      ["src/feature/cycle-b.ts", 1, 1, 2],
    ]);
    assert.ok(report.bridgeFiles.some((item) => item.path === "src/core/index.ts"), JSON.stringify(report.bridgeFiles));
    assert.deepEqual(report.importCycles, [{ paths: ["src/feature/cycle-a.ts", "src/feature/cycle-b.ts"] }]);
    assert.ok(report.weaklyConnectedFiles.includes("docs/overview.md"), JSON.stringify(report.weaklyConnectedFiles));
    assert.ok(report.weaklyConnectedFiles.includes("src/isolated.ts"), JSON.stringify(report.weaklyConnectedFiles));
    assert.equal(report.moduleClusters[0]?.module, "src");
    assert.ok((report.moduleClusters[0]?.files ?? 0) >= 6, JSON.stringify(report.moduleClusters));
    assert.equal(report.moduleClusters[0]?.edges, 4);
  } finally {
    db.close();
  }
});

// The report script used to hardcode the legacy Pi state dir, so it could only ever read the
// operator's own index: a throwaway repo indexed into an isolated state dir reported
// "not approved/indexed yet" no matter how it was indexed. Drive the script as a subprocess with a
// HOME that holds no state at all, so a regression to any home-derived default fails here.
test("report script reads the state dir given by --state-dir or CODEMAP_HOME, not a home-derived default", (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-report-state-"));
  const emptyHome = mkdtempSync(join(tmpdir(), "pi-codemap-report-home-"));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  });

  const root = mkdtempSync(join(tmpdir(), "pi-codemap-report-repo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "leaf.ts"), "export const leaf = 1;\n");
  writeFileSync(join(root, "src", "entry.ts"), "import { leaf } from './leaf';\nexport const entry = leaf;\n");
  indexRepo({ cwd: root, approve: true, stateDir });

  const run = (args: string[], env: Record<string, string>) => JSON.parse(execFileSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/report-architecture.ts", root, ...args],
    { encoding: "utf8", env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, CODEMAP_HOME: "", XDG_DATA_HOME: "", ...env } },
  ));

  for (const [label, invocation] of [
    ["--state-dir", () => run(["--state-dir", stateDir], {})],
    ["CODEMAP_HOME", () => run([], { CODEMAP_HOME: stateDir })],
  ] as const) {
    const output = invocation();
    assert.equal(output.stateDir, stateDir, label);
    assert.deepEqual(
      output.report.highDegreeFiles.map((item: { path: string }) => item.path).sort(),
      ["src/entry.ts", "src/leaf.ts"],
      label,
    );
  }
});
