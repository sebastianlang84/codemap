"""Replay the frozen plugin context request without model calls."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--cli', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
cli = args.cli.resolve()
base = '27f4d6222dd945238e96c1fdaa632d5dc3c37b2c'
cache = Path.home() / '.cache/codemap/external-holdout-v1/repositories/fastify'
root = Path(tempfile.mkdtemp(prefix='codemap-plugin-context-'))
repo = root / 'repo'
repo.mkdir()
env = dict(os.environ, CODEMAP_HOME=str(root / 'state'), CODEMAP_TELEMETRY='0')


def run(command):
    return subprocess.check_output(command, cwd=repo, env=env, stderr=subprocess.PIPE)


try:
    archive = subprocess.check_output(['git', '-C', str(cache), 'archive', base])
    subprocess.run(['tar', '-x', '-C', str(repo)], input=archive, check=True)
    run(['git', 'init', '--quiet'])
    run(['git', 'add', '.'])
    run(['git', '-c', 'user.name=CodeMap Eval', '-c', 'user.email=codemap@example.invalid', 'commit', '--quiet', '-m', 'snapshot'])
    run(['node', str(cli), 'index', '--approve'])
    source = (repo / 'lib/plugin-utils.js').read_text()
    required = '\n'.join(source.splitlines()[63:78])
    contexts = []
    for limit in [1, 4, 8]:
        response = json.loads(run(['node', str(cli), 'context', 'lib/plugin-utils.js:64-78', '--json', '--limit', str(limit)]))
        contexts.append({
            'limit': limit, 'relatedTests': response['relatedTests'], 'relatedDocs': response['relatedDocs'],
            'readFirst': [{key: item[key] for key in ['path', 'startLine', 'endLine', 'reasons']} for item in response['readFirst']],
            'sourceBytes': sum(len(item.get('text', '').encode()) for item in response['readFirst']),
            'completeTarget': response['readFirst'][0].get('text') == required,
        })
    target_test = 'test/internals/plugin.test.js'
    checks = {
        'directTestListed': all(target_test in row['relatedTests'] for row in contexts),
        'directTestWithinFour': target_test in [item['path'] for item in contexts[1]['readFirst']],
        'targetUnchanged': all(row['completeTarget'] for row in contexts),
        'limitsPreserved': all(len(row['readFirst']) <= row['limit'] for row in contexts),
    }
    args.output.write_text(json.dumps({
        'baseCommit': base, 'target': 'lib/plugin-utils.js:64-78',
        'implementationSha256': hashlib.sha256((cli.parent.parent / 'core/context-builder.js').read_bytes()).hexdigest(),
        'contexts': contexts, 'checks': checks, 'passed': all(checks.values()),
        'claimBoundary': 'Direct importing test discovery only; no complete task-context or agent-benefit claim.',
    }, indent=2) + '\n')
finally:
    shutil.rmtree(root)
