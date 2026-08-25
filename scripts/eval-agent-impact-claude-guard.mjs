#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const workspace = process.env.CODEMAP_EVAL_WORKSPACE;
if (!workspace) block("missing CODEMAP_EVAL_WORKSPACE");

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  block("malformed tool hook payload");
}

const tool = event.tool_name;
const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
if (tool === "Bash") checkBash(String(input.command ?? ""));
else if (["Read", "Write", "Edit", "Grep", "Glob"].includes(tool)) checkPaths(input);
process.exit(0);

function checkBash(command) {
  const denied = [
    /(?:^|[;&|\s])(?:curl|wget|gh|ssh|scp|sftp|ftp|telnet|nc|ncat)\b/i,
    /\bhttps?:\/\//i,
    /\bgit\s+(?:clone|fetch|pull|push|remote|ls-remote)\b/i,
    /\b(?:npm|pnpm|yarn)\s+(?:install|add|update|upgrade|ci)\b/i,
    /\bgit\s+(?:commit|tag)\b/i,
    /(?:^|[\s"'])(?:~\/|\/home\/|\/root\/|\/etc\/|\/proc\/|\/sys\/)/,
  ];
  if (denied.some((pattern) => pattern.test(command))) block("network, dependency mutation, external-path access, and git publication are disabled in this benchmark");
}

function checkPaths(input) {
  for (const [key, value] of Object.entries(input)) {
    if (!/(?:path|file|cwd|directory)$/i.test(key) || typeof value !== "string" || value === "") continue;
    const target = resolve(workspace, value);
    const root = resolve(workspace);
    if (target !== root && !target.startsWith(`${root}${sep}`)) block(`tool path escapes benchmark workspace: ${key}`);
  }
}

function block(reason) {
  process.stderr.write(`Agent-impact isolation guard: ${reason}\n`);
  process.exit(2);
}
