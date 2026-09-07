"""Replay frozen historical context tasks against an isolated local CLI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def digest(value):
    return hashlib.sha256(value).hexdigest()


def run(command, **kwargs):
    return subprocess.check_output(command, stderr=subprocess.PIPE, timeout=180, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, help='Frozen result supplying per-case source-byte caps.')
    parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/codemap/external-holdout-v1/repositories')
    args = parser.parse_args()
    manifest_path = Path(__file__).with_suffix('.manifest.json')
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    baseline = json.loads(args.baseline.read_text()) if args.baseline else None
    if baseline and baseline['manifestSha256'] != digest(manifest_bytes):
        raise ValueError('Baseline corpus differs from frozen manifest')
    caps = {row['id']: row['sourceBytes'] for row in baseline['cases']} if baseline else {}
    cli = args.cli.resolve()
    rows = []
    for case in manifest['cases']:
        print(case['id'], flush=True)
        with tempfile.TemporaryDirectory(prefix='codemap-context-program-') as directory:
            root = Path(directory)
            repo = root / 'repo'
            repo.mkdir()
            archive = run(['git', '-C', str(args.cache / case['repo']), 'archive', case['baseCommit']])
            subprocess.run(['tar', '-x', '-C', str(repo)], input=archive, check=True)
            env = dict(os.environ, CODEMAP_HOME=str(root / 'state'), CODEMAP_TELEMETRY='0')
            def local(command):
                return run(command, cwd=repo, env=env)
            for target in case['requiredTargets']:
                lines = (repo / target['path']).read_text().splitlines()
                frozen = '\n'.join(lines[target['startLine'] - 1:target['endLine']])
                if digest(frozen.encode()) != target['sha256']:
                    raise ValueError(f"Ground-truth source drift: {case['id']} {target['path']}")
            for target in case['requiredPaths']:
                if not (repo / target['path']).is_file():
                    raise ValueError(f"Required path absent: {target['path']}")
            local(['git', 'init', '--quiet'])
            local(['git', 'add', '.'])
            local(['git', '-c', 'user.name=CodeMap Eval', '-c', 'user.email=codemap@example.invalid', 'commit', '--quiet', '-m', 'snapshot'])
            local(['node', str(cli), 'index', '--approve'])
            raw = local(['node', str(cli), 'context', case['query'], '--json', '--limit', str(manifest['maxExcerpts'])])
            response = json.loads(raw)
            excerpts = response['readFirst']
            spans = []
            for item in excerpts:
                path = (repo / item['path']).resolve()
                source_valid = False
                if path.is_relative_to(repo) and path.is_file():
                    lines = path.read_text().splitlines()
                    start, end = item.get('startLine', 0), item.get('endLine', 0)
                    source_valid = 1 <= start <= end <= len(lines) and item.get('text') == '\n'.join(lines[start - 1:end])
                spans.append({**{key: item.get(key) for key in ('path', 'startLine', 'endLine', 'reasons', 'scope', 'truncated') if key in item},
                              'sourceBytes': len(item.get('text', '').encode()), 'sourceMatchesSpan': source_valid})
            targets = []
            for target in case['requiredTargets']:
                complete = any(item['sourceMatchesSpan'] and item['path'] == target['path'] and
                               item['startLine'] <= target['startLine'] and item['endLine'] >= target['endLine'] for item in spans)
                targets.append({**target, 'complete': complete})
            paths = [{**target, 'included': any(item['path'] == target['path'] and item['sourceMatchesSpan'] and item['sourceBytes'] > 0 for item in spans)} for target in case['requiredPaths']]
            source_bytes = sum(item['sourceBytes'] for item in spans)
            rows.append({'id': case['id'], 'group': case['group'], 'baseCommit': case['baseCommit'],
                         'query': case['query'], 'targets': targets, 'requiredPaths': paths, 'spans': spans,
                         'sourceBytes': source_bytes, 'responseBytes': len(raw),
                         'completeTargets': all(target['complete'] for target in targets),
                         'completeTaskPackage': all(target['complete'] for target in targets) and all(path['included'] for path in paths),
                         'excerptBudgetPreserved': len(spans) <= manifest['maxExcerpts'],
                         'sourceBudgetPreserved': source_bytes <= caps[case['id']] if baseline else True,
                         'baselineSourceByteCap': caps.get(case['id'], source_bytes),
                         'sourceIntegrity': all(item['sourceMatchesSpan'] for item in spans),
                         'metadataAudit': 'Reasons and scope retained verbatim for review; semantic reason truth is not automatically certified.'})
    result = {'schemaVersion': 1, 'manifestSha256': digest(manifest_bytes),
              'runnerSha256': digest(Path(__file__).read_bytes()),
              'cliSha256': digest(cli.read_bytes()),
              'contextBuilderSha256': digest((cli.parent.parent / 'core/context-builder.js').read_bytes()),
              'nodeVersion': run(['node', '--version']).decode().strip(),
              'mode': 'candidate' if baseline else 'baseline', 'cases': rows,
              'summary': {'caseCount': len(rows), 'completeTargets': sum(row['completeTargets'] for row in rows),
                          'completeTaskPackages': sum(row['completeTaskPackage'] for row in rows),
                          'allBudgetsPreserved': all(row['excerptBudgetPreserved'] and row['sourceBudgetPreserved'] for row in rows),
                          'allSourceIntegrity': all(row['sourceIntegrity'] for row in rows)},
              'claimBoundary': 'Historical retrieval development only. Required paths certify presence of source, not complete test/type/doc content. No agent benefit or executed fix correctness claim.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['summary']))


if __name__ == '__main__':
    main()
