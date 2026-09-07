"""Bounded offline alternative-chunk experiment; does not modify CodeMap."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--cli', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
cli = args.cli.resolve()
manifest = json.loads((Path(__file__).parent / 'eval-agent-impact-context.manifest.json').read_text())
queries = [
    'res.send Uint8Array text/plain UTF-8 charset response',
    'plugin dependency unregistered error catalog error codes',
    'HTTP/2 large Buffer string Content-Length cancellation trailers response',
    'reply trailer handler callback promise first completion chunked framing Content-Length',
]
targets = [('lib/response.js', 112, 212), ('lib/plugin-utils.js', 64, 78),
           ('lib/reply.js', 575, 683), ('lib/reply.js', 823, 877)]


def size(item):
    return len(item.get('text', '').encode())


def select(baseline, chunks, query):
    terms = set(re.findall(r'[a-z0-9]+(?:-[a-z0-9]+)*', query.lower()))
    covered = {term for term in terms if term in baseline[0].get('text', '').lower()}
    selected = [baseline[0]]
    budget = sum(map(size, baseline))
    alternatives = []
    for _ in range(2):
        candidates = []
        for chunk in chunks:
            if any(chunk['startLine'] <= item['endLine'] and chunk['endLine'] >= item['startLine'] for item in selected):
                continue
            novel = {term for term in terms - covered if term in chunk['text'].lower()}
            if novel and sum(map(size, selected)) + size(chunk) <= budget:
                candidates.append((chunk, novel))
        if not candidates:
            break
        chunk, novel = min(candidates, key=lambda pair: (-len(pair[1]), size(pair[0]), pair[0]['startLine']))
        selected.append(chunk)
        covered.update(novel)
        alternatives.append({'startLine': chunk['startLine'], 'endLine': chunk['endLine'], 'newTerms': sorted(novel)})
    for item in baseline[1:]:
        if len(selected) < 8 and sum(map(size, selected)) + size(item) <= budget:
            selected.append(item)
    return selected, alternatives


def spans(items):
    return [{key: item[key] for key in ['path', 'startLine', 'endLine']} for item in items]


rows = []
for task, query, target in zip(manifest['tasks'], queries, targets):
    root = Path(tempfile.mkdtemp(prefix='codemap-alternative-chunks-'))
    repo = root / 'repo'
    repo.mkdir()
    env = dict(os.environ, CODEMAP_HOME=str(root / 'state'), CODEMAP_TELEMETRY='0')

    def run(command):
        return subprocess.check_output(command, cwd=repo, env=env, stderr=subprocess.PIPE)

    try:
        cache = Path.home() / '.cache/codemap/external-holdout-v1/repositories' / task['repo']
        archive = subprocess.check_output(['git', '-C', str(cache), 'archive', task['baseCommit']])
        subprocess.run(['tar', '-x', '-C', str(repo)], input=archive, check=True)
        run(['git', 'init', '--quiet'])
        run(['git', 'add', '.'])
        run(['git', '-c', 'user.name=CodeMap Eval', '-c', 'user.email=codemap@example.invalid', 'commit', '--quiet', '-m', 'snapshot'])
        run(['node', str(cli), 'index', '--approve'])
        response = json.loads(run(['node', str(cli), 'context', query, '--json', '--limit', '8']))
        baseline = response['readFirst']
        with sqlite3.connect(next((root / 'state/repos').glob('*.sqlite'))) as db:
            db.row_factory = sqlite3.Row
            chunks = [dict(row) for row in db.execute(
                "select f.path, c.start_line as startLine, c.end_line as endLine, c.text from chunks c "
                "join files f on f.id=c.file_id where f.path=? and c.kind='function' order by c.start_line",
                (baseline[0]['path'],))]
        candidate, alternatives = select(baseline, chunks, query)
        expected_paths = set(task['expectedPaths'] + task['hiddenTestPaths'])
        lost = [item for item in baseline if item['path'] in expected_paths and item not in candidate]
        target_path, start, end = target
        covers = lambda items: any(item['path'] == target_path and item['startLine'] <= start and item['endLine'] >= end for item in items)
        rows.append({
            'taskId': task['id'], 'baseCommit': task['baseCommit'], 'query': query,
            'baseline': {'spans': spans(baseline), 'sourceBytes': sum(map(size, baseline)), 'targetCovered': covers(baseline)},
            'candidate': {'spans': spans(candidate), 'sourceBytes': sum(map(size, candidate)), 'targetCovered': covers(candidate)},
            'alternatives': alternatives, 'lostExpectedSpans': spans(lost),
            'budgetPreserved': len(candidate) <= 8 and sum(map(size, candidate)) <= sum(map(size, baseline)),
        })
    finally:
        shutil.rmtree(root)

checks = {
    'trailersTargetComplete': rows[-1]['candidate']['targetCovered'],
    'expectedExcerptsPreserved': all(not row['lostExpectedSpans'] for row in rows),
    'targetCoveragePreserved': all(not row['baseline']['targetCovered'] or row['candidate']['targetCovered'] for row in rows),
    'budgetsPreserved': all(row['budgetPreserved'] for row in rows),
}
args.output.write_text(json.dumps({
    'experimentSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'cases': rows, 'checks': checks, 'decision': 'keep-candidate-for-corpus-checks' if all(checks.values()) else 'discard',
    'claimBoundary': 'Retrospective offline selector experiment, not production behavior or agent benefit.',
}, indent=2) + '\n')
