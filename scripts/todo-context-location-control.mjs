import { searchCodeMap } from '../dist/core/search.js';
import { buildCodeMapContext } from '../dist/core/context-builder.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2);
if (argv[0] !== 'context') {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli/bin.js', import.meta.url)), ...argv], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const query = argv[1];
const limit = Number(argv[argv.indexOf('--limit') + 1]) || 8;
const hit = searchCodeMap({ query, limit: 8 })[0];
const response = buildCodeMapContext({ target: hit ? `${hit.path}:${hit.startLine}-${hit.endLine}` : query, limit });
process.stdout.write(JSON.stringify(response) + '\n');
