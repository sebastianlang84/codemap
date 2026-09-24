// Span replay (docs/developer/span-replay-protocol.md): CLI wrapper for scripts/todo-context-eval.py.
// Modes via CODEMAP_SPAN_REPLAY: `skill` replays the bundled skill's search -> context(hit, 1) path,
// `additive` appends up to two uncovered definition spans to the unchanged query context.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../dist/cli/bin.js', import.meta.url));
const argv = process.argv.slice(2);
const call = (args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  // A failed call is what an agent would see: an error message and no excerpt.
  if (result.status !== 0) return { readFirst: [], error: result.stderr.split('\n').filter((line) => !/ExperimentalWarning|trace-warnings/.test(line)).join('\n').trim() };
  return JSON.parse(result.stdout);
};
const visible = (value) => Buffer.byteLength(JSON.stringify(value));
if (argv[0] !== 'context') {
  const result = spawnSync(process.execPath, [cli, ...argv], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const query = argv[1];
const limit = Number(argv[argv.indexOf('--limit') + 1]) || 8;
const mode = process.env.CODEMAP_SPAN_REPLAY;
const search = call(['search', query, '--json', '--limit', '8']);
const hits = search.results ?? [];
const location = (hit) => call(['context', `${hit.path}:${hit.startLine}-${hit.endLine}`, '--json', '--limit', '1']);
let output;
if (mode === 'skill') {
  const context = hits.length ? location(hits[0]) : call(['context', query, '--json', '--limit', '1']);
  output = { ...context, visibleBytes: visible(search) + visible(context) };
} else if (mode === 'additive') {
  const base = call(['context', query, '--json', '--limit', String(limit)]);
  const covered = (item, items) => items.some((other) => item.path === other.path && other.startLine <= item.startLine && other.endLine >= item.endLine);
  const added = [];
  for (const hit of hits) {
    if (added.length === 2) break;
    if (!/^(function|class|type|interface|export)$/.test(hit.kind)) continue;
    const item = location(hit).readFirst[0];
    if (item && !covered(item, [...base.readFirst, ...added])) added.push(item);
  }
  const context = { ...base, readFirst: [...base.readFirst, ...added] };
  output = { ...context, visibleBytes: visible(context) };
} else {
  throw new Error('Unknown CODEMAP_SPAN_REPLAY mode');
}
process.stdout.write(JSON.stringify(output) + '\n');
