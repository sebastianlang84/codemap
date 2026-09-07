"""Frozen local retrieval replay; no agent or fix-correctness claim."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import tempfile
import time


def sha(value):
    return hashlib.sha256(value).hexdigest()


def replay_env(state):
    # Public source replay needs no provider credentials or user Git configuration.
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR') if key in os.environ}
    env.update(CODEMAP_HOME=str(state), CODEMAP_TELEMETRY='0', PGR_OUTPUT_PROFILE='full_v4',
               RIPGREP_CONFIG_PATH='', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null')
    return env


def command(argv, root=None, env=None, data=None, allowed=(0,)):
    started = time.perf_counter()
    result = subprocess.run([str(a) for a in argv], cwd=root, env=env, input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    elapsed = (time.perf_counter() - started) * 1000
    if result.returncode not in allowed:
        raise RuntimeError(f'{argv[0]} exit {result.returncode}: {result.stderr.decode(errors="replace")[-2000:]}')
    return result.stdout, elapsed


def json_text(value):
    return value['text'] if 'text' in value else base64.b64decode(value['bytes']).decode('utf-8')


def normalize_path(path):
    return path[2:] if path.startswith('./') else path


def parse_rg(raw, limit=10, matches=3):
    files = {}
    for line in raw.splitlines():
        event = json.loads(line)
        if event['type'] != 'match':
            continue
        item = event['data']
        path = normalize_path(json_text(item['path']))
        if path not in files and len(files) >= limit:
            continue
        rows = files.setdefault(path, [])
        if len(rows) < matches:
            rows.append((item['line_number'], json_text(item['lines']).rstrip('\n')))
    candidates, native = [], []
    for path, rows in files.items():
        candidates.append({'path': path, 'startLine': rows[0][0], 'endLine': rows[0][0]})
        native.extend(f'{path}:{line}:{text}\n' for line, text in rows)
    return candidates, ''.join(native)


def parse_pgr(native):
    if native.startswith('No matches found.'):
        return []
    if native.startswith('Error:'):
        raise ValueError(native)
    candidates = []
    path = None
    seen = set()
    for line in native.splitlines():
        if line and not line[0].isspace():
            path = normalize_path(line)
        match = re.fullmatch(r'  (\d+)-(\d+):', line)
        if match:
            if path is None:
                raise ValueError('PGR match without file header')
            if path not in seen:
                candidates.append({'path': path, 'startLine': int(match[1]), 'endLine': int(match[2])})
                seen.add(path)
    if not candidates:
        raise ValueError('Unrecognized nonempty PGR response')
    return candidates


def source_path(root, path):
    target = (root / path).resolve()
    if not target.is_relative_to(root.resolve()) or not target.is_file():
        raise ValueError(f'Invalid source path: {path}')
    return target


def read_spans(root, candidates, settings):
    spans, used, seen = [], 0, set()
    for item in candidates:
        path = normalize_path(item['path'])
        if path in seen:
            continue
        seen.add(path)
        if len(seen) > settings['readFiles']:
            break
        lines = source_path(root, path).read_bytes().decode('utf-8').splitlines(keepends=True)
        hit = item['startLine']
        if not isinstance(hit, int) or not 1 <= hit <= len(lines):
            raise ValueError(f'Invalid match line: {path}:{hit}')
        start = max(1, hit - settings['readBefore'])
        selected, stopped = [], False
        for line in lines[start - 1:start - 1 + settings['readLines']]:
            size = len(line.encode('utf-8'))
            if used + size > settings['sourceBytes']:
                stopped = True
                break
            selected.append(line)
            used += size
        if selected:
            text = ''.join(selected)
            end = start + len(selected) - 1
            valid = text == ''.join(lines[start - 1:end])
            if not valid:
                raise ValueError('Source span mismatch')
            spans.append({'path': path, 'startLine': start, 'endLine': end, 'text': text,
                          'sourceBytes': len(text.encode()), 'sha256': sha(text.encode()),
                          'sourceMatchesSpan': valid})
        if stopped:
            break
    return spans


def metrics(candidates, expected, targets, spans):
    paths = list(dict.fromkeys(normalize_path(c['path']) for c in candidates))
    gold = set(expected)
    if not gold:
        raise ValueError('Empty expected paths')
    target_paths = {t['path'] for t in targets}
    ranks = [i + 1 for i, path in enumerate(paths) if path in gold]
    complete = [any(s['path'] == t['path'] and s['startLine'] <= t['startLine']
                    and s['endLine'] >= t['endLine'] for s in spans) for t in targets]
    result = {'mrr': 1 / min(ranks) if ranks else 0,
              'recall5': len(gold.intersection(paths[:5])) / len(gold),
              'recall10': len(gold.intersection(paths[:10])) / len(gold),
              'allGoldAt5': gold.issubset(paths[:5])}
    if targets:
        result.update(targetRecall5=len(target_paths.intersection(paths[:5])) / len(target_paths),
                      targetRecall10=len(target_paths.intersection(paths[:10])) / len(target_paths),
                      completeSpanCount=sum(complete), completeTargetCase=all(complete),
                      completePackageCase=all(complete) and gold.issubset({s['path'] for s in spans}))
    return result


def summarize(rows):
    summary = {}
    for track in ('term', 'regex'):
        profiles = sorted({r['profile'] for r in rows if r['track'] == track})
        summary[track] = {}
        for profile in profiles:
            selected = [r for r in rows if r['track'] == track and r['profile'] == profile]
            summary[track][profile] = {
                'cases': len(selected),
                'mrr': statistics.mean(r['metrics']['mrr'] for r in selected),
                'recall5': statistics.mean(r['metrics']['recall5'] for r in selected),
                'recall10': statistics.mean(r['metrics']['recall10'] for r in selected),
                'allGoldAt5': sum(r['metrics']['allGoldAt5'] for r in selected),
                'completeTargetCases': sum(r['metrics'].get('completeTargetCase', False) for r in selected),
                'completePackageCases': sum(r['metrics'].get('completePackageCase', False) for r in selected),
                'totalNativeResponseBytes': sum(r['nativeResponseBytes'] for r in selected),
                'totalMedianMs': sum(r['medianMs'] for r in selected),
                'allStable': all(r['stableResults'] for r in selected)}
    gates = {}
    for track, treatment, control, field in [('regex', 'pgr', 'rg', 'allGoldAt5'),
                                            ('term', 'bm25', 'codemap_fts', 'completeTargetCase')]:
        a = {r['id']: r for r in rows if r['track'] == track and r['profile'] == treatment}
        b = {r['id']: r for r in rows if r['track'] == track and r['profile'] == control}
        if not a or a.keys() != b.keys():
            gates[treatment] = {'passed': False, 'reason': 'Missing matched cases'}
            continue
        wins = sum(a[k]['metrics'][field] and not b[k]['metrics'][field] for k in a)
        losses = sum(b[k]['metrics'][field] and not a[k]['metrics'][field] for k in a)
        sa, sb = summary[track][treatment], summary[track][control]
        checks = {'atLeastTwoAdditionalCompleteCases': wins - losses >= 2, 'noLostCompleteCases': losses == 0,
                  'stableResults': sa['allStable'] and sb['allStable']}
        if track == 'regex':
            checks.update(mrrNotLower=sa['mrr'] >= sb['mrr'],
                          responseBudget=sa['totalNativeResponseBytes'] <= 1.10 * sb['totalNativeResponseBytes'])
        else:
            checks['recall5NotLower'] = sa['recall5'] >= sb['recall5']
        gates[treatment] = {'passed': all(checks.values()), 'wins': wins, 'losses': losses, 'checks': checks}
    return {'profiles': summary, 'continuationGates': gates}


def helper_call(helper, request, root=None, env=None):
    raw, elapsed = command(['node', '--experimental-strip-types', helper], root, env,
                           json.dumps(request).encode())
    return json.loads(raw), raw, elapsed


def search(profile, root, state, query, args, settings, env):
    if profile in ('codemap', 'bm25', 'codemap_fts'):
        response, raw, elapsed = helper_call(args.helper, {'profile': profile, 'root': str(root),
            'state': str(state), 'query': query, 'limit': settings['searchLimit']}, root, env)
        return response['candidates'], response['nativeResponse'], raw, elapsed, response.get('indexedPaths'), response.get('pool')
    if profile == 'rg':
        raw, elapsed = command(['rg', '--sort', 'path', '--json', '--', query, '.'], root, env, allowed=(0, 1))
        candidates, native = parse_rg(raw, settings['searchLimit'], settings['matchesPerFile'])
        return candidates, native, raw, elapsed, None, None
    messages = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'search_code',
                 'arguments': {'query': query, 'max_files': settings['searchLimit'],
                               'max_matches_per_file': settings['matchesPerFile']}}}]
    raw, elapsed = command([args.pgr], root, env, ''.join(json.dumps(m) + '\n' for m in messages).encode())
    replies = [json.loads(line) for line in raw.splitlines() if line.strip()]
    response = [r for r in replies if r.get('id') == 2]
    if len(response) != 1 or 'error' in response[0] or response[0].get('result', {}).get('isError'):
        raise ValueError('Invalid PGR RPC response')
    native = response[0]['result']['content'][0]['text']
    return parse_pgr(native), native, raw, elapsed, None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_suffix('.manifest.json'))
    for flag in ('helper', 'pgr', 'cli', 'cache', 'output'):
        parser.add_argument('--' + flag, type=Path, required=True)
    args = parser.parse_args()
    for flag in ('manifest', 'helper', 'pgr', 'cli', 'cache', 'output'):
        setattr(args, flag, getattr(args, flag).resolve())
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    settings = manifest['settings']
    if sha(args.pgr.read_bytes()) != manifest['pgrBinarySha256']:
        raise ValueError('PGR binary differs from frozen manifest')
    # Hash only named development sources; never inspect reference patches or confirmation files.
    repo_root = args.manifest.parent.parent
    if args.helper != repo_root / 'scripts/eval-search-tool-comparison.ts' or args.cli != repo_root / 'dist/cli/bin.js':
        raise ValueError('Helper and built CLI must belong to the frozen source checkout')
    source_paths = ['src', 'migrations', 'package.json', 'package-lock.json']
    command(['git', '-C', repo_root, 'diff', '--exit-code', '--quiet', manifest['codeMapCommit'], '--', *source_paths])
    dirty, _ = command(['git', '-C', repo_root, 'status', '--porcelain', '--untracked-files=all', '--', *source_paths])
    if dirty:
        raise ValueError('Uncommitted product source changes')
    product_tree, _ = command(['git', '-C', repo_root, 'rev-parse', manifest['codeMapCommit'] + ':src'])
    for path, expected in manifest['sourceManifests'].items():
        if sha((repo_root / path).read_bytes()) != expected:
            raise ValueError(f'Source manifest drift: {path}')
    rows, indexes = [], []
    for track, cases in [('term', manifest['termCases']), ('regex', manifest['regexCases'])]:
        for index, case in enumerate(cases):
            print(f'{track} {case["id"]}', flush=True)
            with tempfile.TemporaryDirectory(prefix='codemap-tool-replay-') as directory:
                work = Path(directory)
                root, state = work / 'repo', work / 'state'
                root.mkdir()
                archive, _ = command(['git', '-C', args.cache / case['repo'], 'archive', case['baseCommit']])
                command(['tar', '-x', '-C', root], data=archive)
                targets = case.get('requiredTargets', [])
                expected = sorted({t['path'] for t in targets} | {p['path'] for p in case.get('requiredPaths', [])}) if track == 'term' else case['expectedPaths']
                for path in expected:
                    source_path(root, path)
                for target in targets:
                    lines = source_path(root, target['path']).read_text().splitlines()
                    if sha('\n'.join(lines[target['startLine'] - 1:target['endLine']]).encode()) != target['sha256']:
                        raise ValueError(f'Target source drift: {case["id"]}')
                env = replay_env(state)
                command(['git', 'init', '--quiet'], root, env)
                command(['git', 'add', '.'], root, env)
                command(['git', '-c', 'user.name=CodeMap Eval', '-c', 'user.email=codemap@example.invalid', 'commit', '--quiet', '-m', 'snapshot'], root, env)
                query, plan = case['query'], None
                if track == 'term':
                    _, duration = command(['node', args.cli, 'index', '--approve'], root, env)
                    indexes.append({'id': case['id'], 'indexMs': duration})
                    plan, _, _ = helper_call(args.helper, {'profile': 'plan', 'query': query}, root, env)
                    if not plan['terms']:
                        raise ValueError('Empty term plan')
                    regex = '(?i)' + '|'.join(re.escape(term) for term in plan['terms'])
                else:
                    regex = query
                # pgr masks rg errors as empty results; validate each pattern before timing either arm.
                command(['rg', '--json', '--', regex, '.'], root, env, allowed=(0, 1))
                available_raw, _ = command(['rg', '--files'], root, env, allowed=(0, 1))
                rg_paths = set(normalize_path(p) for p in available_raw.decode().splitlines())
                profiles = ['codemap', 'bm25', 'codemap_fts', 'rg', 'pgr'] if track == 'term' else ['rg', 'pgr']
                order = profiles[index % len(profiles):] + profiles[:index % len(profiles)]
                collected = {p: [] for p in profiles}
                for repeat in range(settings['repeats']):
                    for profile in order:
                        collected[profile].append(search(profile, root, state, regex if profile in ('rg', 'pgr') else query, args, settings, env))
                if track == 'term':
                    pools = [a[5] for p in ('bm25', 'codemap_fts') for a in collected[p]]
                    if any(pool is None or pool != pools[0] for pool in pools):
                        raise ValueError('BM25/control candidate pools differ')
                for profile in profiles:
                    attempts = collected[profile]
                    candidates, native, _, _, indexed_paths, pool = attempts[0]
                    spans = read_spans(root, candidates, settings)
                    stable = all(a[0] == candidates and a[1] == native for a in attempts)
                    available = set(indexed_paths) if indexed_paths is not None else rg_paths if profile in ('rg', 'pgr') else None
                    rows.append({'track': track, 'id': case['id'], 'profile': profile,
                        'baseCommit': case['baseCommit'], 'query': query, 'regex': regex, 'plan': plan,
                        'executionOrder': order, 'expectedPaths': expected,
                        'poolSha256': sha(json.dumps(pool, sort_keys=True).encode()) if pool is not None else None,
                        'poolSize': len(pool) if pool is not None else None,
                        'availableExpectedPaths': sorted(set(expected) & available) if available is not None else None,
                        'candidates': candidates, 'spans': spans, 'nativeResponse': native,
                        'nativeResponseBytes': len(native.encode()), 'sourceBytes': sum(s['sourceBytes'] for s in spans),
                        'totalResponseBytes': len(native.encode()) + sum(s['sourceBytes'] for s in spans),
                        'stdoutSha256': [sha(a[2]) for a in attempts], 'durationsMs': [a[3] for a in attempts],
                        'medianMs': statistics.median(a[3] for a in attempts), 'stableResults': stable,
                        'repeatRankingSha256': [sha(json.dumps(a[0], sort_keys=True).encode()) for a in attempts],
                        'metrics': metrics(candidates, expected, targets, spans)})
    versions = {name: command(argv)[0].decode().strip() for name, argv in
                [('node', ['node', '--version']), ('rg', ['rg', '--version']), ('git', ['git', '--version']),
                 ('python', ['python3', '--version']), ('codemap', ['node', args.cli, '--version'])]}
    result = {'schemaVersion': 1, 'manifestSha256': sha(manifest_bytes), 'runnerSha256': sha(Path(__file__).read_bytes()),
              'helperSha256': sha(args.helper.read_bytes()), 'pgrSha256': sha(args.pgr.read_bytes()),
              'cliSha256': sha(args.cli.read_bytes()), 'rgSha256': sha(Path(shutil.which('rg')).read_bytes()),
              'codeMapSourceTree': product_tree.decode().strip(),
              'codeMapCommit': manifest['codeMapCommit'], 'pgrCommit': manifest['pgrCommit'],
              'versions': versions, 'settings': settings, 'indexing': indexes, 'cases': rows,
              'summary': summarize(rows), 'claimBoundary': 'Frozen historical retrieval replay only; static rg is not adaptive agent navigation. No fix-correctness or agent-benefit claim.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    args.output.chmod(0o600)
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
