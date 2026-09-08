"""Replay two isolated rule ablations on the known development corpus."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile

BASE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('comparison', BASE / 'scripts/eval-search-tool-comparison.py')
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)
sha = lambda data: hashlib.sha256(data).hexdigest()


def run(command, **kwargs):
    return subprocess.check_output(command, stderr=subprocess.PIPE, timeout=180, **kwargs)


def context_spans(root, candidates, budget=16384):
    spans, used = [], 0
    for item in candidates[:8]:
        source = comparison.source_path(root, item['path']).read_text()
        lines = source.splitlines(keepends=True) or ['']
        if source.endswith('\n'):
            lines.append('')
        start, end = item['startLine'], item['endLine']
        if not 1 <= start <= end <= len(lines):
            raise ValueError('Invalid source interval')
        selected, stopped = [], False
        for line in lines[start - 1:end]:
            if used + len(line.encode()) > budget:
                stopped = True
                break
            selected.append(line)
            used += len(line.encode())
        if selected:
            text = ''.join(selected)
            spans.append({'path': item['path'], 'startLine': start, 'endLine': start + len(selected) - 1,
                          'sourceBytes': len(text.encode()), 'sha256': sha(text.encode()), 'sourceMatchesSpan': True})
        if stopped:
            break
    return spans


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/codemap/external-holdout-v1/repositories')
    args = parser.parse_args()
    manifest_path = BASE / 'scripts/eval-context-program.manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    records = []
    for case in manifest['cases']:
        print(case['id'], flush=True)
        with tempfile.TemporaryDirectory(prefix='todo-rules-') as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            archive = run(['git', '-C', str(args.cache / case['repo']), 'archive', case['baseCommit']])
            subprocess.run(['tar', '-x', '-C', str(root)], input=archive, check=True)
            run(['git', 'init', '--quiet'], cwd=root)
            for target in case['requiredTargets']:
                lines = comparison.source_path(root, target['path']).read_text().splitlines()
                if sha('\n'.join(lines[target['startLine'] - 1:target['endLine']]).encode()) != target['sha256']:
                    raise ValueError('Frozen target source drift')
            payload = json.dumps({'root': str(root), 'state': str(Path(directory) / 'state'), 'query': case['query']}).encode()
            attempts = [json.loads(run(['node', '--experimental-strip-types', str(BASE / 'scripts/todo-rules.ts')],
                                      input=payload, env=dict(os.environ, CODEMAP_TELEMETRY='0'))) for _ in range(2)]
            if attempts[0] != attempts[1]:
                raise ValueError('Unstable ablation output')
            result = attempts[0]
            expected = list(dict.fromkeys(t['path'] for t in case['requiredTargets'] + case['requiredPaths']))
            for experiment in ('search', 'context'):
                profiles = {}
                for profile in ('baseline', 'ablated'):
                    candidates = result[experiment][profile]
                    spans = comparison.read_spans(root, candidates, {'readFiles': 8, 'readBefore': 40, 'readLines': 160, 'sourceBytes': 16384}) if experiment == 'search' else context_spans(root, candidates)
                    metrics = comparison.metrics(candidates, expected, case['requiredTargets'], spans)
                    profiles[profile] = {'metrics': metrics, 'sourceBytes': sum(s['sourceBytes'] for s in spans),
                                         'candidates': [{k: c[k] for k in ('path', 'startLine', 'endLine')} for c in candidates],
                                         'spans': [{k: v for k, v in s.items() if k != 'text'} for s in spans]}
                    assert profiles[profile]['sourceBytes'] <= 16384
                records.append({'id': case['id'], 'baseCommit': case['baseCommit'], 'experiment': experiment,
                                'query': case['query'], 'expectedPaths': expected, 'poolSha256': result[experiment]['poolSha256'],
                                'poolSizes': result[experiment].get('poolSizes', [result[experiment].get('poolSize')]),
                                'nativeParity': result['nativeParity'], 'stable': True, 'profiles': profiles})
    summary = {}
    for experiment in ('search', 'context'):
        rows = [r for r in records if r['experiment'] == experiment]
        metrics = {profile: {'completeTargets': sum(r['profiles'][profile]['metrics']['completeTargetCase'] for r in rows),
                             'completePackages': sum(r['profiles'][profile]['metrics']['completePackageCase'] for r in rows),
                             'recall5': statistics.mean(r['profiles'][profile]['metrics']['recall5'] for r in rows),
                             'mrr': statistics.mean(r['profiles'][profile]['metrics']['mrr'] for r in rows),
                             'sourceBytes': sum(r['profiles'][profile]['sourceBytes'] for r in rows)}
                   for profile in ('baseline', 'ablated')}
        wins = [r['id'] for r in rows if r['profiles']['ablated']['metrics']['completeTargetCase'] and not r['profiles']['baseline']['metrics']['completeTargetCase']]
        losses = [r['id'] for r in rows if r['profiles']['baseline']['metrics']['completeTargetCase'] and not r['profiles']['ablated']['metrics']['completeTargetCase']]
        passed = len(wins) >= 2 and not losses and metrics['ablated']['recall5'] >= metrics['baseline']['recall5']
        summary[experiment] = {'profiles': metrics, 'wins': wins, 'losses': losses, 'gatePassed': passed,
                               'changedRankings': [r['id'] for r in rows if r['profiles']['baseline']['candidates'] != r['profiles']['ablated']['candidates']]}
    output = {'schemaVersion': 1, 'productBase': 'ef10b97', 'manifestSha256': sha(manifest_bytes),
              'protocolSha256': sha((BASE / 'docs/developer/todo-rules-protocol.md').read_bytes()),
              'runnerSha256': sha(Path(__file__).read_bytes()), 'helperSha256': sha((BASE / 'scripts/todo-rules.ts').read_bytes()),
              'comparisonHelperSha256': sha((BASE / 'scripts/eval-search-tool-comparison.py').read_bytes()),
              'sourceTree': run(['git', 'rev-parse', 'HEAD:src'], cwd=BASE).decode().strip(),
              'nodeVersion': run(['node', '--version']).decode().strip(), 'cases': records, 'summary': summary,
              'claimBoundary': 'Known development retrieval only; frozen candidate membership and ranges; no latency, agent or unseen generalization claim.'}
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
