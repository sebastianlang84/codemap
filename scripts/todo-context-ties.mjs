import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../dist/cli/bin.js', import.meta.url));
const prototype = fileURLToPath(new URL('./todo-context-prototype.mjs', import.meta.url));
const rows = [];
for (const fixture of ['equal', 'comment']) {
  const root = mkdtempSync(join(tmpdir(), 'todo-context-tie-'));
  const env = { ...process.env, CODEMAP_HOME: join(root, 'state'), CODEMAP_CONTEXT_EXPERIMENT: 'uncertain', CODEMAP_TELEMETRY: '0' };
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const source = 'export function dispatchMessage(message: string) {\n  return message;\n}\n';
    writeFileSync(join(root, 'a.ts'), source);
    writeFileSync(join(root, 'b.ts'), (fixture === 'comment' ? '// handler\n' : '') + source);
    execFileSync(process.execPath, [cli, 'index', '--approve'], { cwd: root, env, stdio: 'pipe' });
    for (const query of ['dispatchMessage handler', 'handler dispatchMessage', 'dispatchmessage handler']) {
      const run = script => JSON.parse(execFileSync(process.execPath, [script, 'context', query, '--json', '--limit', '8'], { cwd: root, env }));
      const base = run(cli), candidate = run(prototype);
      const spans = candidate.readFirst;
      const bytes = response => response.readFirst.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
      rows.push({ fixture, query, anchors: candidate.experimentalAnchors, uncertain: candidate.experimentalUncertain,
        baselineBytes: bytes(base), candidateBytes: bytes(candidate), budgetPreserved: bytes(candidate) <= bytes(base) && spans.length <= 8,
        sourceIntegrity: spans.every(item => item.text === readFileSync(join(root, item.path), 'utf8').split('\n').slice(item.startLine - 1, item.endLine).join('\n')),
        baselinePaths: base.readFirst.map(item => item.path), candidatePaths: spans.map(item => item.path) });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log(JSON.stringify(rows, null, 2));
