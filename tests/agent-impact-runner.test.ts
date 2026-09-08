import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("oracle validation checks public tests before hidden replacements and rejects broken public commands", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-runner-test-"));
  const repo = join(root, "cache", "repositories", "fixture");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git("init", "--quiet");
    writeFileSync(join(repo, "value.cjs"), "module.exports = 0;\n");
    writeFileSync(join(repo, "test.cjs"), "require('node:assert').equal(typeof require('./value.cjs'), 'number');\n");
    git("add", "value.cjs", "test.cjs");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "base");
    const baseCommit = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "value.cjs"), "module.exports = 1;\n");
    writeFileSync(join(repo, "test.cjs"), "require('node:assert').equal(require('./value.cjs'), 1, 'regression marker');\n");
    git("add", "value.cjs", "test.cjs");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fix");
    const manifest = JSON.parse(readFileSync(new URL("../scripts/eval-agent-impact.manifest.json", import.meta.url), "utf8"));
    manifest.repositories = [{ id: "fixture", remote: "https://github.com/fixture/project" }];
    manifest.pilotGate.minValidPairs = 1;
    manifest.tasks = [{ id: "fixture-task", repo: "fixture", sourceUrl: "https://github.com/fixture/project/pull/1",
      prompt: "Correct the value.", baseCommit, fixCommit: git("rev-parse", "HEAD"), expectedPaths: ["value.cjs"],
      hiddenTestPaths: ["test.cjs"], expectedBaseFailure: "regression marker", forbiddenChangePaths: [], setupFiles: [],
      publicTestCommand: [process.execPath, "test.cjs"],
      setup: { file: process.execPath, args: ["-e", ""], timeoutMs: 5000 },
      verify: { file: process.execPath, args: ["test.cjs"], timeoutMs: 5000 } }];
    const manifestPath = join(root, "manifest.json");
    const validate = () => {
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/eval-agent-impact.ts",
        "--manifest", manifestPath, "--offline", "--cache-dir", join(root, "cache"), "--validate-oracles"],
      { encoding: "utf8", timeout: 30_000 });
      assert.ok(result.stdout.trim(), result.stderr);
      return { status: result.status, oracle: JSON.parse(result.stdout).oracles[0] };
    };
    const good = validate();
    assert.equal(good.status, 0);
    assert.equal(good.oracle.valid, true);
    assert.deepEqual(good.oracle.publicTestExitCodes, { base: [0, 0], reference: [0, 0] });
    assert.deepEqual(good.oracle.baseHiddenTestExitCodes, [1, 1]);
    assert.deepEqual(good.oracle.referenceFixExitCodes, [0, 0]);
    manifest.tasks[0].qualityChecks = [{ id: "source-types", baseline: "pass",
      command: { file: process.execPath, args: ["-e", "console.error('type error');process.exit(1)"], timeoutMs: 5000 } }];
    const badTypes = validate();
    assert.equal(badTypes.status, 1, "behavior-only reference must not pass with failing quality checks");
    assert.equal(badTypes.oracle.valid, false);
    assert.equal(badTypes.oracle.quality.reference[0].every((item: { passed: boolean }) => item.passed), false);
    manifest.tasks[0].qualityChecks[0].command.args = ["-e", ""];
    const goodTypes = validate();
    assert.equal(goodTypes.status, 0);
    assert.equal(goodTypes.oracle.quality.base.length, 2);
    assert.equal(goodTypes.oracle.quality.reference.length, 2);
    manifest.tasks[0].qualityChecks = [{ id: "new-call-signature", baseline: "feature-failure", expectedBaseFailure: "missing signature",
      command: { file: process.execPath, args: ["-e", "if(require('./value.cjs')!==1){console.error('missing signature');process.exit(1)}"], timeoutMs: 5000 } }];
    const featureTypes = validate();
    assert.equal(featureTypes.status, 0);
    assert.equal(featureTypes.oracle.quality.base[0][0].exitCode, 1);
    assert.equal(featureTypes.oracle.quality.base[0][0].passed, true);
    assert.equal(featureTypes.oracle.quality.reference[0][0].exitCode, 0);
    const source = "scripts/fixtures/agent-impact-reference-marker.patch";
    const sha256 = createHash("sha256").update(readFileSync(source)).digest("hex");
    manifest.tasks[0].referencePatch = { source, sha256 };
    manifest.tasks[0].qualityChecks[0].command.args = ["-e", "if(!require('node:fs').existsSync('type-marker.cjs')){console.error('missing signature');process.exit(1)}"];
    const augmented = validate();
    assert.equal(augmented.status, 0, "augmentation must reach the reference only");
    assert.equal(augmented.oracle.quality.base[0][0].exitCode, 1);
    assert.equal(augmented.oracle.quality.reference[0][0].exitCode, 0);
    manifest.tasks[0].referencePatch.sha256 = "0".repeat(64);
    assert.match(validate().oracle.error, /Reference patch hash mismatch/);
    delete manifest.tasks[0].referencePatch;
    delete manifest.tasks[0].qualityChecks;
    manifest.tasks[0].publicTestCommand = [process.execPath, "does-not-exist.cjs"];
    const bad = validate();
    assert.equal(bad.status, 1);
    assert.equal(bad.oracle.valid, false);
    assert.equal(bad.oracle.baseFails, true);
    assert.equal(bad.oracle.referencePasses, true);
    assert.deepEqual(bad.oracle.publicTestExitCodes, { base: [1, 1], reference: [1, 1] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
