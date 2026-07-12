#!/usr/bin/env node
import { runCli } from "./main.ts";

const result = runCli(process.argv.slice(2));
if (result.out) process.stdout.write(result.out.endsWith("\n") ? result.out : `${result.out}\n`);
if (result.err) process.stderr.write(result.err.endsWith("\n") ? result.err : `${result.err}\n`);
process.exit(result.code);
