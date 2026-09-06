"""Reproduce the retrospective Fastify context probe without models or dependencies."""

import argparse
import hashlib
import io
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path

BASE = 'ff7eff5eec8a820b2c6f79b477e1a784bbf42341'
PROFILE = '91cbdc0a2da280a4ea7a3e74c80c6fd4489c695c'
READS = [('lib/validation.js', 118, 146), ('test/schema-special-usage.test.js', 692, 719)]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repository', type=Path, required=True, help='Cached Fastify Git repository')
parser.add_argument('--cli', type=Path, required=True, help='Pinned CodeMap dist/cli/bin.js')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
cli = args.cli.resolve()
cli_hash = hashlib.sha256(cli.read_bytes()).hexdigest()
if cli_hash != '7ba5691a1d84a395b08da5a799fed460dc0848192afd35956d66bc705fada958':
    raise ValueError('CLI does not match the frozen profile; use a separate protocol for another build')


def run(argv, cwd):
    return subprocess.run(argv, cwd=cwd, capture_output=True, check=True).stdout


with tempfile.TemporaryDirectory(prefix='codemap-validator-') as directory:
    root = Path(directory)
    repo = root / 'repo'
    repo.mkdir()
    archive = run(['git', '-C', str(args.repository.resolve()), 'archive', BASE], root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(repo, filter='data')
    run(['git', 'init', '-q'], repo)
    common = ['--repo', str(repo), '--state-dir', str(root / 'state')]
    # Approval is restricted to the disposable fixture used by this requested probe.
    run(['node', str(cli), 'index', '--approve', *common], repo)
    run(['node', str(cli), 'index', *common], repo)
    search = json.loads(run(['node', str(cli), 'search', 'custom validator', '--limit', '5', '--json', *common], repo))
    grep = run(['grep', '-rilF', '--', 'custom validator', 'lib', 'test', 'docs'], repo)
    contexts = []
    for target in ['validateParam', 'test/schema-special-usage.test.js']:
        raw = run(['node', str(cli), 'context', target, '--json', *common], repo)
        data = json.loads(raw)
        excerpts = data['readFirst']
        for excerpt in excerpts:
            lines = (repo / excerpt['path']).read_text().splitlines()
            expected = '\n'.join(lines[excerpt['startLine'] - 1:excerpt['endLine']])
            if excerpt['text'].rstrip('\n') != expected.rstrip('\n'):
                raise ValueError('Returned source differs from fixture')
        contexts.append({
            'target': target,
            'sourceBytes': sum(len(item['text'].encode()) for item in excerpts),
            'excerpts': [
                {key: item[key] for key in ('path', 'startLine', 'endLine')}
                for item in excerpts
            ],
        })
    baseline = [run(['sed', '-n', f'{start},{end}p',path], repo) for path, start, end in READS]
    result = {
        'baseCommit': BASE,
        'profileCommit': PROFILE,
        'cliSha256': cli_hash,
        'query': 'custom validator',
        'searchPaths': [item['path'] for item in search['results']],
        'grepFirstFivePaths': grep.decode().splitlines()[:5],
        'grepMethod': 'grep -rilF -- "custom validator" lib test docs; first five paths in traversal order, not relevance ranking',
        'baseline': {'reads': READS, 'calls': 2, 'sourceBytes': sum(map(len, baseline))},
        'codemap': {'calls': 2, 'sourceBytes': sum(item['sourceBytes'] for item in contexts), 'contexts': contexts},
        'sourceMatchesFixture': True,
        'claimBoundary': 'Retrospective development case, not agent savings. Both context targets and baseline ranges were known from trace/source inspection. Discovery is separate. Source bytes exclude JSON metadata. No ranking or runtime change.',
    }
args.output.write_text(json.dumps(result, indent=2) + '\n')
