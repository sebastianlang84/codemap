#!/usr/bin/env node
import { collectStateGcCandidates, pruneState, type StateGcResult } from "../src/core/state-gc.ts";

interface ParsedArgs {
  apply: boolean;
  json: boolean;
  stateDir?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--state-dir") parsed.stateDir = argv[++i];
    else if (arg.startsWith("--state-dir=")) parsed.stateDir = arg.slice("--state-dir=".length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return parsed;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function reportHuman(result: StateGcResult, apply: boolean): void {
  console.log(`State dir: ${result.stateDir}`);
  console.log(`Repo DBs: ${result.repoDbCount} | Registry repos: ${result.registryRepoCount}`);
  if (result.candidates.length === 0) {
    console.log("Nothing to reclaim; state is clean.");
    return;
  }
  console.log(`${apply ? "Removed" : "Reclaimable"}: ${result.candidates.length} DB(s), ${formatBytes(result.reclaimableBytes)}`);
  for (const candidate of result.candidates) {
    const detail = candidate.reason === "missing_root" ? ` (missing root: ${candidate.rootPath})` : " (no registry entry)";
    console.log(`  - ${candidate.key}.sqlite  ${formatBytes(candidate.bytes)}  [${candidate.reason}]${detail}`);
  }
  if (apply) {
    console.log(`Registry rows removed: ${result.removedRegistryRows}`);
  } else {
    console.log("Dry-run; re-run with --apply to delete these DBs and their registry rows.");
  }
}

const parsed = parseArgs(process.argv.slice(2));
const options = { stateDir: parsed.stateDir };
const result = parsed.apply ? pruneState({ ...options, apply: true }) : collectStateGcCandidates(options);

if (parsed.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  reportHuman(result, parsed.apply);
}
