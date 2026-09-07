"""Reproduce the Express symbol/query miss with the frozen diagnostic profile."""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

base = 'af7cd90893f4619212e01f271fbaa10f3176fb33'
profile_commit = '54df28cf0d9965d3e8bed831c27013a8a8248685'
cache = Path.home() / '.cache/codemap/external-holdout-v1'
profile = cache / 'profiles' / f'codemap-0.10.1-{profile_commit[:12]}'
source = subprocess.check_output([
    'git', '-C', str(cache / 'repositories/express'), 'show', f'{base}:lib/response.js'
]).decode()
module = (profile / 'dist/core/symbols.js').as_uri()
program = f'''import {{extractSymbols}} from {json.dumps(module)};
import {{readFileSync}} from "node:fs";
const source=readFileSync(0,"utf8");
console.log(JSON.stringify({{
 checks:[112,395].map(line=>({{line,source:source.split("\\n")[line-1],symbols:extractSymbols(source,"javascript").filter(s=>s.startLine===line)}})),
 minimal:["res.send = function send(body) {{", "sendfile(res, file, opts, function (err) {{"].map(source=>({{source,symbols:extractSymbols(source,"javascript")}}))
}}));'''
extraction = json.loads(subprocess.check_output(
    ['node', '--input-type=module', '-e', program], input=source.encode()))
result = {
    'taskId': 'express-pr-6285', 'baseCommit': base, 'path': 'lib/response.js',
    'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
    'extractorCommit': profile_commit, **extraction,
    'claimBoundary': 'Retrospective extraction reproduction only. Does not isolate ranking causality or measure agent effect.',
}
root = Path(tempfile.mkdtemp(prefix='codemap-context-query-'))
repo = root / 'repo'
repo.mkdir()
env = dict(os.environ, CODEMAP_HOME=str(root / 'state'), CODEMAP_TELEMETRY='0')


def run(command):
    return subprocess.check_output(command, cwd=repo, env=env, stderr=subprocess.PIPE)


try:
    archive = subprocess.check_output(['git', '-C', str(cache / 'repositories/express'), 'archive', base])
    subprocess.run(['tar', '-x', '-C', str(repo)], input=archive, check=True)
    run(['git', 'init', '--quiet'])
    run(['git', 'add', '.'])
    run(['git', '-c', 'user.name=CodeMap Eval', '-c', 'user.email=codemap@example.invalid',
         'commit', '--quiet', '-m', 'base snapshot'])
    cli = ['node', str(profile / 'dist/cli/bin.js')]
    run([*cli, 'index', '--approve'])
    rows = []
    for query in ['res.send Uint8Array text/plain UTF-8 charset response', 'res.send', 'send']:
        response = json.loads(run([*cli, 'search', query, '--json']))
        rows.append({
            'query': query, 'stale': response['stale'], 'confidence': response.get('topHitConfidence'),
            'results': [{key: value for key, value in item.items()
                         if key in ['path', 'startLine', 'endLine', 'kind', 'snippet', 'score']}
                        for item in response['results']],
        })
    result['queryProbe'] = rows
    Path('docs/developer/agent-impact-context-symbol-probe.json').write_text(json.dumps(result, indent=2) + '\n')
finally:
    shutil.rmtree(root)
