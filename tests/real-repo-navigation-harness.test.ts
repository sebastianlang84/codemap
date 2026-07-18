import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const scriptPath = join(repoRoot, "scripts", "eval-real-repo-navigation.ts");

test("real-repo gate selects env-configured suites and warns instead of failing for missing repos", () => {
  const root = mkdtempSync(join(tmpdir(), "codemap-real-repo-harness-"));
  try {
    const macrolens = join(root, "missing-macrolens");
    const memory = join(root, "missing-memory");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, "--local-repos", "--quality-gate"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        CODEMAP_EVAL_REPOS: `macrolens=${macrolens},pi-ext-memory=${memory}`,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(
      payload.report.repos.map((repo: { label: string; root: string; skipped?: string }) => ({ label: repo.label, root: repo.root, skipped: repo.skipped })),
      [
        { label: "macrolens", root: macrolens, skipped: "missing repo" },
        { label: "pi-ext-memory", root: memory, skipped: "missing repo" },
      ],
    );
    assert.equal(payload.gate.passed, true);
    assert.deepEqual(payload.gate.issues, []);
    assert.deepEqual(
      payload.gate.warnings.map((warning: { label: string; metric: string }) => ({ label: warning.label, metric: warning.metric })),
      [
        { label: "macrolens", metric: "repo" },
        { label: "pi-ext-memory", metric: "repo" },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real-repo gate keeps strict missing-repo enforcement explicit", () => {
  const root = mkdtempSync(join(tmpdir(), "codemap-real-repo-harness-"));
  try {
    const missing = join(root, "missing-macrolens");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, "--quality-gate", "--require-repos"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CODEMAP_EVAL_REPOS: `macrolens=${missing}` },
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate.passed, false);
    assert.deepEqual(payload.gate.issues, payload.gate.warnings);
    assert.equal(payload.gate.issues[0].metric, "repo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real-repo gate adapts corpus-size thresholds to an available configured subset", () => {
  const root = mkdtempSync(join(tmpdir(), "codemap-real-repo-subset-"));
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, "--quality-gate"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CODEMAP_EVAL_REPOS: `alpha-cycles=${root}` },
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.report.repos.map((repo: { label: string }) => repo.label), ["alpha-cycles"]);
    assert.equal(payload.gate.issues.some((issue: { metric: string }) => issue.metric === "tasks"), false);
    assert.equal(payload.gate.issues.some((issue: { metric: string }) => issue.metric === "avgExpectedRecall"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
