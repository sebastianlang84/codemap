import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { runCli } = await import("../src/cli/main.ts");

function cliRepo(t: { after(fn: () => void): void }): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-cli-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-cli-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "widget.ts"), "export function renderWidget() {\n  return \"ok\";\n}\n");
  return { root, stateDir };
}

test("cli help and version do not touch the repo", () => {
  assert.match(runCli(["--help"]).out, /Usage:/);
  assert.match(runCli([]).out, /Usage:/);
  assert.match(runCli(["--version"]).out, /^\d+\.\d+\.\d+/);
});

test("cli index/search/context/status round-trip on an isolated state dir", (t) => {
  const { root, stateDir } = cliRepo(t);
  const io = { cwd: root };

  const indexed = runCli(["index", "--approve", "--state-dir", stateDir], io);
  assert.equal(indexed.code, 0);
  assert.match(indexed.out, /Indexed \d+\/\d+ files/);

  const search = runCli(["search", "renderWidget", "--state-dir", stateDir], io);
  assert.equal(search.code, 0);
  assert.match(search.out, /src\/widget\.ts:\d+(-\d+)? \[function\] .+ — [\d.]+/);

  const context = runCli(["context", "src/widget.ts", "--state-dir", stateDir], io);
  assert.equal(context.code, 0);
  assert.match(context.out, /src\/widget\.ts:\d+-\d+ \[[a-z]+\] \(target\)/);

  const located = runCli(["context", "src/widget.ts:1", "--json", "--state-dir", stateDir], io);
  assert.equal(located.code, 0);
  assert.equal(JSON.parse(located.out).contextTarget, "src/widget.ts");

  const status = runCli(["status", "--state-dir", stateDir], io);
  assert.equal(status.code, 0);
  assert.match(status.out, /readiness: ready/);
});

test("cli --json emits a parseable search package", (t) => {
  const { root, stateDir } = cliRepo(t);
  const io = { cwd: root };
  runCli(["index", "--approve", "--state-dir", stateDir], io);

  const result = runCli(["search", "renderWidget", "--json", "--state-dir", stateDir], io);
  assert.equal(result.code, 0);
  const pkg = JSON.parse(result.out) as { query: string; results: Array<{ path: string }> };
  assert.equal(pkg.query, "renderWidget");
  assert.equal(pkg.results[0]?.path, "src/widget.ts");
});

test("cli executable drains large JSON to a slow pipe before exiting", async (t) => {
  const { root, stateDir } = cliRepo(t);
  writeFileSync(join(root, "guide.md"), `# Guide\n${`${"A documented behavior. ".repeat(50)}\n`.repeat(350)}`);
  runCli(["index", "--approve", "--state-dir", stateDir], { cwd: root });
  const args = ["context", "guide.md", "--json", "--state-dir", stateDir];
  const expected = runCli(args, { cwd: root });
  assert.equal(expected.code, 0);
  assert.ok(Buffer.byteLength(expected.out) > 256 * 1024);

  const child = spawn(process.execPath, ["--experimental-strip-types",
    fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url)), ...args],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stderr.resume();
  // Delay consumption after the first bytes arrive to exercise pipe backpressure.
  await new Promise<void>((resolve) => child.stdout.once("readable", resolve));
  await delay(100);
  const chunks: Buffer[] = [];
  for await (const chunk of child.stdout) chunks.push(chunk);
  assert.equal(await closed, 0);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), JSON.parse(expected.out));
});

test("cli context text preserves ambiguous-target warnings", (t) => {
  const { root, stateDir } = cliRepo(t);
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "lib", "widget.ts"), "export const otherWidget = true;\n");
  const io = { cwd: root };
  runCli(["index", "--approve", "--state-dir", stateDir], io);

  const result = runCli(["context", "widget.ts", "--state-dir", stateDir], io);
  assert.equal(result.code, 0);
  assert.match(result.out, /Ambiguous target "widget\.ts"/);
  assert.match(result.out, /src\/widget\.ts|lib\/widget\.ts/);
});

test("cli reports usage errors on stderr with a non-zero code", () => {
  const missingQuery = runCli(["search"]);
  assert.equal(missingQuery.code, 2);
  assert.match(missingQuery.err, /needs a query/);

  const unknownCommand = runCli(["frobnicate"]);
  assert.equal(unknownCommand.code, 2);
  assert.match(unknownCommand.err, /Unknown command/);

  const unknownOption = runCli(["search", "x", "--nope"]);
  assert.equal(unknownOption.code, 2);
  assert.match(unknownOption.err, /Unknown option/);
});

test("cli nudge-check hints on a broad grep when ready, including during working-tree edits", (t) => {
  const { root, stateDir } = cliRepo(t);
  const io = { cwd: root };

  // Not indexed yet → fail-open, silent, exit 0.
  const beforeIndex = runCli(["nudge-check", "rg renderWidget", "--state-dir", stateDir], io);
  assert.equal(beforeIndex.code, 0);
  assert.equal(beforeIndex.out, "");

  runCli(["index", "--approve", "--state-dir", stateDir], io);

  // Broad search on an indexed, fresh repo → hint on stdout, exit 1.
  const broad = runCli(["nudge-check", "rg renderWidget", "--state-dir", stateDir], io);
  assert.equal(broad.code, 1);
  assert.match(broad.out, /codemap search/);

  writeFileSync(join(root, "src", "widget.ts"), "export function renderWidget() { return \"edited\"; }\n");
  const whileEditing = runCli(["nudge-check", "rg renderWidget", "--state-dir", stateDir], io);
  assert.equal(whileEditing.code, 1);
  assert.match(whileEditing.out, /codemap search/);

  // A concrete file operand → not broad → silent, exit 0.
  const concrete = runCli(["nudge-check", "grep -n renderWidget src/widget.ts", "--state-dir", stateDir], io);
  assert.equal(concrete.code, 0);
  assert.equal(concrete.out, "");

  // Missing command → usage error, exit 2.
  const missing = runCli(["nudge-check", "--state-dir", stateDir], io);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /needs a shell command/);

  // --json shape mirrors the exit code.
  const json = runCli(["nudge-check", "rg renderWidget", "--json", "--state-dir", stateDir], io);
  assert.equal(json.code, 1);
  assert.deepEqual(JSON.parse(json.out), { nudge: true, readiness: "ready", hint: broad.out });
});

test("cli --limit rejects non-positive-integers before they reach SQL", (t) => {
  // Each of these previously reached the SQL bind as NaN/float and died with an opaque datatype error.
  for (const value of ["abc", "0", "-5", "3.5"]) {
    const result = runCli(["search", "x", "--limit", value]);
    assert.equal(result.code, 2, `--limit ${value} should be a usage error`);
    assert.match(result.err, /positive integer/);
  }
  const missingValue = runCli(["search", "x", "--limit"]);
  assert.equal(missingValue.code, 2);
  assert.match(missingValue.err, /positive integer/);

  // A valid limit still round-trips.
  const { root, stateDir } = cliRepo(t);
  const io = { cwd: root };
  runCli(["index", "--approve", "--state-dir", stateDir], io);
  const ok = runCli(["search", "renderWidget", "--limit", "1", "--state-dir", stateDir], io);
  assert.equal(ok.code, 0);
});

test("cli usage-report reads both generations and emits aggregate-only JSON without logging itself", (t) => {
  const { root, stateDir } = cliRepo(t);
  const privateQuery = "private-customer-secret";
  const privatePath = "/home/alice/private/repo/src/customer.ts";
  const older = JSON.stringify({
    v: 1,
    ts: "2026-08-23T10:00:00.000Z",
    tool_version: "0.9.1",
    command: "search",
    adapter: "cli",
    repo_key: "0123456789abcdef01234567",
    repo_root: root,
    query: privateQuery,
    outcome: "ok",
    latency_ms: 12,
    results: [{ path: privatePath, score: 12, kind: "text", language: "typescript" }],
  });
  const current = JSON.stringify({
    v: 1,
    ts: "2026-08-24T11:00:00.000Z",
    tool_version: "0.9.1",
    command: "context",
    adapter: "mcp",
    repo_key: "0123456789abcdef01234567",
    repo_root: root,
    target: privatePath,
    target_form: "path",
    resolved_path: privatePath,
    outcome: "ok",
    latency_ms: 20,
  });
  writeFileSync(join(stateDir, "usage.jsonl.1"), `${older}\n`);
  writeFileSync(join(stateDir, "usage.jsonl"), `${current}\n`);
  const before = `${current}\n`;

  const result = runCli(["usage-report", "--json", "--state-dir", stateDir], { cwd: root });
  assert.equal(result.code, 0);
  const report = JSON.parse(result.out) as {
    privacy: string;
    period: { firstDate: string; lastDate: string };
    overview: { totalEvents: number; distinctRepos: number; byCommand: Record<string, number> };
  };
  assert.equal(report.privacy, "aggregate");
  assert.deepEqual(report.period, { firstDate: "2026-08-23", lastDate: "2026-08-24" });
  assert.equal(report.overview.totalEvents, 2);
  assert.equal(report.overview.distinctRepos, 1);
  assert.deepEqual(report.overview.byCommand, { context: 1, search: 1 });
  for (const secret of [stateDir, root, privateQuery, privatePath, "0123456789abcdef01234567"]) {
    assert.equal(result.out.includes(secret), false, `usage report leaked ${secret}`);
  }
  assert.equal(readFileSync(join(stateDir, "usage.jsonl"), "utf8"), before);

  const filtered = runCli(["usage-report", "--repo", root, "--since", "2026-08-24", "--json", "--state-dir", stateDir], { cwd: root });
  assert.equal(filtered.code, 0);
  assert.equal(JSON.parse(filtered.out).overview.totalEvents, 1);
  assert.deepEqual(JSON.parse(filtered.out).period, { firstDate: "2026-08-24", lastDate: "2026-08-24" });
});

test("cli usage-report has stable empty JSON and strict filters", (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-empty-usage-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));

  const empty = runCli(["usage-report", "--json", "--state-dir", stateDir], { cwd: stateDir });
  assert.equal(empty.code, 0);
  assert.equal(JSON.parse(empty.out).overview.totalEvents, 0);

  for (const args of [
    ["--since", "not-a-date"],
    ["--since", "2026-02-30"],
    ["--window", "0"],
    ["--window", "1.5"],
    ["--nope"],
    ["unexpected"],
  ]) {
    const invalid = runCli(["usage-report", ...args, "--state-dir", stateDir], { cwd: stateDir });
    assert.equal(invalid.code, 2, args.join(" "));
  }

  const badRepo = runCli(["usage-report", "--repo", join(stateDir, "missing"), "--state-dir", stateDir]);
  assert.equal(badRepo.code, 1);
  assert.equal(badRepo.err, "--repo must be an existing Git repository or a 24-character repository key");

  mkdirSync(join(stateDir, "usage.jsonl"));
  const unreadable = runCli(["usage-report", "--state-dir", stateDir]);
  assert.equal(unreadable.code, 1);
  assert.equal(unreadable.err, "Unable to read the local usage telemetry log");
  assert.equal(unreadable.err.includes(stateDir), false);
});
