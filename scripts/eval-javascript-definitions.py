"""Compare definition extraction and complete Express context without model calls."""

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
base = 'af7cd90893f4619212e01f271fbaa10f3176fb33'
cache = Path.home() / '.cache/codemap/external-holdout-v1/repositories/express'
source = subprocess.check_output(['git', '-C', str(cache), 'show', f'{base}:lib/response.js']).decode()
required = '\n'.join(source.splitlines()[111:212])
module = (cli.parent.parent / 'core/symbols.js').as_uri()
program = f'''import {{extractSymbols}} from {json.dumps(module)};
import {{readFileSync}} from "node:fs";
console.log(JSON.stringify(extractSymbols(readFileSync(0,"utf8"),"javascript")));'''
symbols = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], input=source.encode()))
root = Path(tempfile.mkdtemp(prefix='codemap-definitions-'))
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
    run(['git', '-c', 'user.name=CodeMap Eval', '-c', 'user.email=codemap@example.invalid', 'commit', '--quiet', '-m', 'base snapshot'])
    run(['node', str(cli), 'index', '--approve'])
    searches = []
    for query in ['res.send Uint8Array text/plain UTF-8 charset response', 'res.send', 'send']:
        response = json.loads(run(['node', str(cli), 'search', query, '--json']))
        rank = next((n for n, hit in enumerate(response['results'], 1)
                     if hit['path'] == 'lib/response.js' and hit['startLine'] == 112), None)
        searches.append({'query': query, 'targetRank': rank,
                         'topFive': [{key: hit[key] for key in ['path', 'startLine', 'endLine', 'kind']}
                                     for hit in response['results'][:5]]})
    contexts = []
    for query in ['res.send', 'send', 'lib/response.js:112']:
        response = json.loads(run(['node', str(cli), 'context', query, '--json', '--limit', '1']))
        item = response['readFirst'][0]
        contexts.append({'target': query, 'path': item['path'], 'startLine': item['startLine'],
                         'endLine': item['endLine'], 'sourceBytes': len(item.get('text', '').encode()),
                         'completeExactBody': item['path'] == 'lib/response.js' and item.get('text') == required})
    definition_names = [symbol['name'] for symbol in symbols if symbol['startLine'] == 112]
    checks = {
        'assignedNames': set(definition_names) == {'res.send', 'send'},
        'callNotDefinition': not any(symbol['startLine'] == 395 for symbol in symbols),
        'allQueriesFindTargetInFive': all(row['targetRank'] is not None and row['targetRank'] <= 5 for row in searches),
        'exactQueriesRankFirst': all(row['targetRank'] == 1 for row in searches[1:]),
        'allContextsComplete': all(row['completeExactBody'] for row in contexts),
    }
    hashes = {name: hashlib.sha256((cli.parent.parent / 'core' / name).read_bytes()).hexdigest()
              for name in ['symbols.js', 'chunker.js', 'index-store.js', 'javascript-syntax.js']
              if (cli.parent.parent / 'core' / name).exists()}
    args.output.write_text(json.dumps({
        'baseCommit': base, 'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
        'implementationHashes': hashes, 'definitionNames': definition_names,
        'searches': searches, 'contexts': contexts, 'checks': checks, 'passed': all(checks.values()),
        'claimBoundary': 'Frozen retrospective local case; no agent-benefit or generalization claim.',
    }, indent=2) + '\n')
finally:
    shutil.rmtree(root)
