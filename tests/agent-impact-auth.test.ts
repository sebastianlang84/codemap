import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentImpactToken, isolatedAgentImpactClaude, redactAgentImpactToken, withoutClaudeAuth } from "../scripts/eval-agent-impact-auth.ts";

const token = "dummy-automation-token";

test("isolated credential replacement and cleanup leave personal credentials untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-auth-test-"));
  try {
    const personal = join(root, "personal-credentials.json");
    writeFileSync(personal, "personal-dummy", { mode: 0o600 });
    const workspace = join(root, "workspace");
    const env = isolatedAgentImpactClaude(workspace, { hooks: {} }, token);
    assert.deepEqual(readdirSync(env.CLAUDE_CONFIG_DIR!), ["settings.json"]);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, token);
    assert.ok(!readFileSync(env.CODEMAP_EVAL_CLAUDE_SETTINGS!, "utf8").includes(token));
    // Reproduce the credential writer's atomic replacement using dummy content.
    const tmp = join(env.CLAUDE_CONFIG_DIR!, "credentials.tmp");
    writeFileSync(tmp, "refreshed-dummy");
    renameSync(tmp, join(env.CLAUDE_CONFIG_DIR!, ".credentials.json"));
    rmSync(workspace, { recursive: true });
    assert.equal(readFileSync(personal, "utf8"), "personal-dummy");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("automation token is explicit and alternative provider credentials are excluded", () => {
  const inherited = { PATH: "/bin", ANTHROPIC_API_KEY: "dummy-key", ANTHROPIC_AUTH_TOKEN: "dummy-bearer",
    ANTHROPIC_BASE_URL: "https://example.invalid", CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "dummy-refresh", CLAUDE_CODE_OAUTH_TOKEN: token,
    CODEMAP_EVAL_OAUTH_TOKEN_FILE: "/dummy/path" };
  assert.deepEqual(withoutClaudeAuth(inherited), { PATH: "/bin" });
  assert.throws(() => agentImpactToken({}), /Dedicated automation token required/);
  assert.throws(() => agentImpactToken(inherited), /Set only/);
  assert.equal(agentImpactToken({ CLAUDE_CODE_OAUTH_TOKEN: token }), token);
  assert.equal(redactAgentImpactToken(`${token} twice ${token}`, token), "[REDACTED] twice [REDACTED]");
});

test("token files must be private and contain a token, not an OAuth credential document", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-auth-test-"));
  try {
    const file = join(root, "token");
    writeFileSync(file, `${token}\n`, { mode: 0o600 });
    assert.equal(agentImpactToken({ CODEMAP_EVAL_OAUTH_TOKEN_FILE: file }), token);
    writeFileSync(file, '{"claudeAiOauth":"dummy"}');
    assert.throws(() => agentImpactToken({ CODEMAP_EVAL_OAUTH_TOKEN_FILE: file }), /Dedicated automation token/);
    if (process.platform !== "win32") {
      chmodSync(file, 0o644);
      assert.throws(() => agentImpactToken({ CODEMAP_EVAL_OAUTH_TOKEN_FILE: file }), /private regular file/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing automation token stops paid runner before cache, workspace or model setup", () => {
  const root = mkdtempSync(join(tmpdir(), "impact-auth-test-"));
  try {
    const cache = join(root, "cache");
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/eval-agent-impact.ts",
      "--approve-budget-usd", "8", "--cache-dir", cache], {
      env: withoutClaudeAuth(process.env), encoding: "utf8",
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Dedicated automation token required/);
    assert.equal(existsSync(cache), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
