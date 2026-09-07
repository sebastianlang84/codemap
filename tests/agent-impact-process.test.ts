import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runObservedCodexProcess } from "../scripts/eval-agent-impact-process.ts";

const defaults = { timeoutMs: 3000, maxBuffer: 1024 * 1024 };
const event = (type: string, id: string) => JSON.stringify({ type: `item.${type}`, item: { id, type: "command_execution", command: `echo ${id}` } });
const run = (script: string, options = {}) => runObservedCodexProcess(process.execPath, ["-e", script], { ...defaults, ...options });

test("observes split JSONL, concurrent item ids, malformed lines and UTF-8 without changing output", async () => {
  const prefix = event("started", "a");
  const middle = `\nmalformed\n${event("started", "b")}\n${event("completed", "a")}\n`;
  const tail = event("completed", "b");
  const result = await run(`process.stdout.write(${JSON.stringify(prefix.slice(0, 17))});
    setTimeout(() => process.stdout.write(${JSON.stringify(prefix.slice(17) + middle)}), 30);
    setTimeout(() => { process.stdout.write(${JSON.stringify(tail)}); process.stderr.write('ä diagnostic'); }, 80);`);
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout, prefix + middle + tail);
  assert.equal(result.stderr, "ä diagnostic");
  assert.equal(result.toolTimings.length, 2);
  const [a, b] = result.toolTimings;
  assert.equal(a.itemId, "a");
  assert.equal(a.observedDurationMs, 0, "events received in one chunk have no inferred duration");
  assert.ok(b.observedDurationMs! >= 0);
  assert.equal(b.observedDurationMs, b.observedEndMs! - b.observedStartMs!);
});

test("timeout preserves incomplete output and open command with null duration", async () => {
  const text = `${event("started", "a")}\n{"partial":`;
  const result = await run(`process.stdout.write(${JSON.stringify(text)}); setInterval(() => {}, 1000);`, { timeoutMs: 500 });
  assert.equal(result.timedOut, true);
  assert.equal(result.status, null);
  assert.equal(result.stdout, text);
  assert.equal(result.toolTimings[0].observedEndMs, null);
  assert.equal(result.toolTimings[0].observedDurationMs, null);
});

test("orphan completion and duplicate events retain one timing per id", async () => {
  const text = `${event("completed", "a")}\n${event("completed", "a")}\nnull\n${event("started", "b")}\n${event("started", "b")}\n`;
  const result = await run(`process.stdout.write(${JSON.stringify(text)}); process.exitCode = 7;`);
  assert.equal(result.status, 7);
  assert.equal(result.toolTimings.length, 2);
  assert.equal(result.toolTimings[0].observedStartMs, null);
  assert.equal(result.toolTimings[0].observedDurationMs, null);
});

test("stdin, cwd and env reach child, including split UTF-8 bytes", async () => {
  const result = await run(`process.stdin.resume(); process.stdin.on('data', d => process.stderr.write(d));
    process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa4])), 10);
    process.on('exit', () => process.stderr.write(process.cwd() + process.env.OBSERVED_TEST));`,
    { cwd: tmpdir(), env: { OBSERVED_TEST: "test" }, input: "prompt" });
  assert.equal(result.stdout, "ä");
  assert.equal(result.stderr, `prompt${tmpdir()}test`);
});

test("spawn error resolves and early stdin closure does not throw", async () => {
  const failed = await runObservedCodexProcess("/nonexistent/observed-process", [], defaults);
  assert.equal(failed.status, null);
  assert.match(failed.error!, /ENOENT/);
  assert.equal(failed.timedOut, false);
  const early = await run("process.exit(0)", { input: "x".repeat(2 * 1024 * 1024) });
  assert.equal(early.status, 0);
});

test("combined output overflow is bounded and explicitly fails", async () => {
  const result = await run("process.stdout.write('a'.repeat(50)); setTimeout(() => process.stderr.write('b'.repeat(10000)), 30); setInterval(() => {}, 1000);", { maxBuffer: 100 });
  assert.equal(result.stdout, "a".repeat(50));
  assert.equal(result.stderr, "b".repeat(50));
  assert.match(result.error!, /exceeded maxBuffer/);
  assert.equal(result.timedOut, false);
});

test("timeout kills descendants in the Linux process group", { skip: process.platform !== "linux" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "codemap-observed-process-"));
  const pidFile = join(directory, "pid");
  try {
    const result = await run(`const {spawn} = require('node:child_process'); const {writeFileSync} = require('node:fs');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
      writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000);`, { timeoutMs: 500 });
    assert.equal(result.timedOut, true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    // Killed grandchildren may remain zombies until the host init reaps them.
    let running = false;
    try { running = !readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].startsWith("Z"); }
    catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "ENOENT"); }
    assert.equal(running, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("external signals and invalid limits are explicit", async () => {
  const result = await run("process.kill(process.pid, 'SIGTERM')");
  assert.equal(result.status, null);
  assert.equal(result.timedOut, false);
  assert.match(result.error!, /SIGTERM/);
  assert.throws(() => runObservedCodexProcess(process.execPath, [], { ...defaults, maxBuffer: 0 }), /positive safe integers/);
});
