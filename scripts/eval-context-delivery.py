#!/usr/bin/env python3
"""Offline, frozen output-only experiment; does not modify runtime behavior."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts/eval-context-delivery.manifest.json'


def compact(package, budget):
    """Preserve order and metadata; add only complete code chunks within budget."""
    warnings = [('(!) ' + warning) for warning in package['warnings']]
    if package['stale']:
        warnings.append('(!) index is stale; refresh before relying on source')
    rows = []
    for item in package['readFirst']:
        label = f"{item['path']}:{item['startLine']}-{item['endLine']}"
        rows.append(label + ' [source omitted]')
    if not rows:
        rows.append('No read-first items')
    selected = []
    for i, item in enumerate(package['readFirst']):
        if item['language'] in ('markdown', 'json', 'yaml', 'toml', 'text') or 'text' not in item:
            continue
        original = rows[i]
        rows[i] = original.removesuffix(' [source omitted]') + '\n' + item['text']
        if len(('\n'.join(warnings + rows) + '\n').encode()) <= budget:
            selected.append(item)
        else:
            rows[i] = original
    return '\n'.join(warnings + rows) + '\n', selected


def score(output, selected, case, repo, manifest):
    wanted = {}
    for span in case['required']:
        lines = (repo / span['path']).read_text().splitlines()
        assert 1 <= span['start'] <= span['end'] <= len(lines), span
        for line in range(span['start'], span['end'] + 1):
            wanted[(span['path'], line)] = lines[line - 1]
    available = {}
    unrelated = 0
    for item in selected:
        for offset, text in enumerate(item['text'].splitlines()):
            key = (item['path'], item['startLine'] + offset)
            available[key] = text
            if key not in wanted:
                unrelated += len((text + '\n').encode())
    missing = [f'{path}:{line}' for (path, line), text in wanted.items()
               if available.get((path, line)) != text]
    size = len(output.encode())
    complete = bool(wanted) and not missing
    budget_ok = size <= manifest['maxOutputBytes']
    if case.get('expect') == 'omitted':
        passed = not complete and not selected and 'source omitted' in output and budget_ok
    elif case.get('expect') == 'empty':
        passed = not selected and 'No read-first items' in output and budget_ok
    else:
        passed = complete and budget_ok and unrelated <= manifest['maxUnrelatedSourceBytes']
    return {'bytes': size, 'unrelatedSourceBytes': unrelated, 'requiredSourceComplete': complete,
            'missingRequiredLineCount': len(missing), 'passed': passed,
            'outputSha256': hashlib.sha256(output.encode()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fastify-cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('ANTHROPIC_', 'CLAUDE_CODE_OAUTH_', 'CLAUDE_CODE_USE_'))
           and k != 'CODEMAP_EVAL_OAUTH_TOKEN_FILE'}

    def run(command, cwd, **kwargs):
        return subprocess.run(command, cwd=cwd, env=env, check=True,
                              stderr=subprocess.PIPE, **kwargs)

    def archive(source, commit, target):
        target.mkdir()
        content = run(['git', 'archive', commit], source, stdout=subprocess.PIPE).stdout
        run(['tar', '-x', '-C', str(target)], ROOT, input=content)

    rows = []
    with tempfile.TemporaryDirectory(prefix='codemap-compact-eval-') as temporary:
        base = Path(temporary)
        profile = base / 'profile'
        archive(ROOT, manifest['baselineCommit'], profile)
        repos = {'fastify': base / 'fastify', 'fixture': base / 'fixture'}
        archive(args.fastify_cache.resolve(), manifest['fastifyCommit'], repos['fastify'])
        repos['fixture'].mkdir()
        for path, text in manifest['fixtures'].items():
            (repos['fixture'] / path).write_text(text)

        def cli(repo, *arguments):
            command = ['node', str(profile / 'dist/cli/bin.js'), *arguments,
                       '--state-dir', str(base / ('state-' + repo.name))]
            return run(command, repo, stdout=subprocess.PIPE).stdout.decode()

        for repo in repos.values():
            run(['git', 'init', '--quiet'], repo, stdout=subprocess.PIPE)
            cli(repo, 'index', '--approve')
        for case in manifest['cases']:
            repo = repos[case['repo']]
            plain = cli(repo, 'context', case['target'])
            raw = cli(repo, 'context', case['target'], '--json')
            package = json.loads(raw)
            candidate, selected = compact(package, manifest['maxOutputBytes'])
            assert all(warning in candidate for warning in package['warnings'])
            variants = [('plain', plain, []), ('json', raw,
                         [item for item in package['readFirst'] if 'text' in item]),
                        ('compact', candidate, selected)]
            rows.append({'id': case['id'], 'expect': case.get('expect', 'complete'),
                         'readPlan': [{'path': item['path'], 'start': item['startLine'],
                                       'end': item['endLine'],
                                       'sourceBytes': len(item.get('text', '').encode()),
                                       'emitted': item in selected}
                                      for item in package['readFirst']],
                         'variants': {name: score(output, items, case, repo, manifest)
                                      for name, output, items in variants}})
    positives = [row for row in rows if row['expect'] == 'complete']
    controls = [row for row in rows if row['expect'] != 'complete']
    passed = sum(row['variants']['compact']['passed'] for row in positives)
    control_passes = sum(row['variants']['compact']['passed'] for row in controls)
    report = {'experiment': manifest['id'],
              'manifestSha256': hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
              'baselineCommit': manifest['baselineCommit'],
              'candidateScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'positivePasses': passed, 'positiveCases': len(positives),
              'controlPasses': control_passes, 'controlCases': len(controls),
              'decision': 'keep' if passed == len(positives) and control_passes == len(controls) else 'discard',
              'claimBoundary': 'Local source availability only; no observed agent read savings.',
              'cases': rows}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('positivePasses', 'positiveCases',
                                                 'controlPasses', 'controlCases', 'decision')}))


if __name__ == '__main__':
    main()
