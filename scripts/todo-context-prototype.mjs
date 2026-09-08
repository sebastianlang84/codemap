import { buildCodeMapContext } from '../dist/core/context-builder.js';
import { searchCodeMap } from '../dist/core/search.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2);
if (argv[0] !== 'context') {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli/bin.js', import.meta.url)), ...argv], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const query = argv[1];
const limit = Number(argv[argv.indexOf('--limit') + 1]) || 8;
const base = buildCodeMapContext({ target: query, limit });
const hits = searchCodeMap({ query, limit: 8 });
const mode = process.env.CODEMAP_CONTEXT_EXPERIMENT;
const bytes = item => Buffer.byteLength(item.text ?? '');
const cap = base.readFirst.reduce((sum, item) => sum + bytes(item), 0);
const location = hit => buildCodeMapContext({ target: `${hit.path}:${hit.startLine}-${hit.endLine}`, limit });
const covered = (item, items) => items.some(other => item.path === other.path && other.startLine <= item.startLine && other.endLine >= item.endLine);
function bounded(items) {
  const result = [];
  let used = 0;
  for (const item of items) {
    if (!item || covered(item, result) || result.length >= limit || used + bytes(item) > cap) continue;
    result.push(item); used += bytes(item);
  }
  return result;
}
let selected = base.readFirst;
if (mode === 'spans') {
  const added = hits.filter(hit => /^(function|class|type|interface|export)$/.test(hit.kind))
    .map(hit => location(hit).readFirst[0]).filter(item => item && !covered(item, base.readFirst)).slice(0, 2);
  selected = bounded([base.readFirst[0], ...added, ...base.readFirst.slice(1)]);
} else if (mode === 'bytes') {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]+/g) ?? [])];
  selected = base.readFirst.map(item => {
    const lines = item.text.split('\n');
    const scores = lines.map(line => terms.filter(term => line.toLowerCase().includes(term)).length);
    const anchor = scores.indexOf(Math.max(...scores));
    const budget = Math.floor(bytes(item) * 0.8);
    let lo = anchor, hi = anchor;
    if (Buffer.byteLength(lines[anchor]) > budget) return null;
    let changed = true;
    while (changed) {
      changed = false;
      if (lo > 0 && Buffer.byteLength(lines.slice(lo - 1, hi + 1).join('\n')) <= budget) { lo--; changed = true; }
      if (hi + 1 < lines.length && Buffer.byteLength(lines.slice(lo, hi + 2).join('\n')) <= budget) { hi++; changed = true; }
    }
    const text = lines.slice(lo, hi + 1).join('\n');
    return { ...item, startLine: item.startLine + lo, endLine: item.startLine + hi, text, snippet: text, truncated: true };
  }).filter(Boolean);
} else if (mode === 'joint' && hits.length) {
  const anchored = location(hits[0]);
  selected = bounded([...anchored.readFirst.map(item => {
    const match = hits.find(hit => hit.path === item.path);
    return match ? location(match).readFirst[0] : item;
  }), ...base.readFirst]);
} else if (mode === 'uncertain') {
  const [first, second] = hits;
  const uncertain = first && second && first.path !== second.path &&
    Math.abs(first.score - second.score) / Math.max(Math.abs(first.score), Number.EPSILON) <= 0.1;
  if (uncertain) selected = bounded([base.readFirst[0], location(second).readFirst[0], ...base.readFirst.slice(1)]);
  base.experimentalAnchors = [query, query.toLowerCase(), query.split(/\s+/).reverse().join(' ')].map(variant => {
    const ranked = searchCodeMap({ query: variant, limit: 2 });
    return { query: variant, hits: ranked.map(({ path, score, startLine }) => ({ path, score, startLine })) };
  });
  base.experimentalUncertain = Boolean(uncertain);
} else if (!['spans', 'bytes', 'joint', 'uncertain'].includes(mode)) throw new Error('Unknown experiment');
process.stdout.write(JSON.stringify({ ...base, readFirst: selected }) + '\n');
