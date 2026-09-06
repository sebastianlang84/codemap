import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function withoutClaudeAuth(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_)/.test(key) && key !== "CODEMAP_EVAL_OAUTH_TOKEN_FILE"));
}

export function agentImpactToken(source: NodeJS.ProcessEnv): string {
  const inline = source.CLAUDE_CODE_OAUTH_TOKEN;
  const file = source.CODEMAP_EVAL_OAUTH_TOKEN_FILE;
  if (inline && file) throw new Error("Set only CLAUDE_CODE_OAUTH_TOKEN or CODEMAP_EVAL_OAUTH_TOKEN_FILE");
  let token = inline;
  if (file) {
    const stat = lstatSync(file);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
      throw new Error("Eval token file must be a private regular file (mode 0600)");
    }
    token = readFileSync(file, "utf8").trim();
  }
  if (!token || /[\s{}"]/.test(token)) {
    throw new Error("Dedicated automation token required: run claude setup-token and set CLAUDE_CODE_OAUTH_TOKEN or CODEMAP_EVAL_OAUTH_TOKEN_FILE");
  }
  return token;
}

export function isolatedAgentImpactClaude(root: string, settings: Record<string, unknown>, token: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  const configDir = join(root, "claude-config");
  const settingsPath = join(configDir, "settings.json");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return {
    HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDir,
    CODEMAP_EVAL_CLAUDE_SETTINGS: settingsPath, CLAUDE_CODE_OAUTH_TOKEN: token,
  };
}

export function redactAgentImpactToken(output: string, token: string): string {
  return token ? output.replaceAll(token, "[REDACTED]") : output;
}
