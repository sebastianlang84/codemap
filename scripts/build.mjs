#!/usr/bin/env node
import { chmodSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

rmSync("dist", { recursive: true, force: true });
const result = spawnSync(process.execPath, ["./node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
  cwd: process.cwd(),
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const bin of ["dist/cli/bin.js", "dist/mcp/bin.js"]) chmodSync(bin, 0o755);
