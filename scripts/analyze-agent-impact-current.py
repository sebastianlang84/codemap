#!/usr/bin/env python3
"""Summarize paired evidence without changing its gate or exposing raw traces."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random

SEED = 20260907
DRAWS = 10000
MODES = ('baseline', 'codemap')
TIMES = ('agentDurationMs', 'indexDurationMs', 'setupDurationMs',
         'preflightDurationMs', 'verifierDurationMs')
TOKENS = ('inputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'outputTokens')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def percentile(values, probability):
    position = (len(values) - 1) * probability
    lo, hi = math.floor(position), math.ceil(position)
    return values[lo] + (values[hi] - values[lo]) * (position - lo)


def bootstrap(pairs, key, stratified=False):
    strata = [[p for p in pairs if p['repo'] == repo] for repo in sorted({p['repo'] for p in pairs})] if stratified else [pairs]
    rng = random.Random(SEED)
    estimates = []
    for _ in range(DRAWS):
        sample = [stratum[rng.randrange(len(stratum))] for stratum in strata for _ in stratum]
        value = ratio(sum(p['codemap'][key] for p in sample), sum(p['baseline'][key] for p in sample))
        if value is not None:
            estimates.append(value)
    estimates.sort()
    return {'draws': DRAWS, 'validDraws': len(estimates), 'seed': SEED, 'stratifiedByRepo': stratified,
            'stratumSizes': [len(stratum) for stratum in strata],
            'percentile95': [percentile(estimates, q) for q in (0.025, 0.975)] if len(estimates) == DRAWS else None}


def run_metrics(run):
    usage = run['usage']
    if not all(number(usage.get(key)) for key in TOKENS):
        raise ValueError('Missing or invalid normalized token usage')
    if not all(number(run.get(key)) for key in TIMES[:2]):
        raise ValueError('Missing or invalid agent/index time')
    if any(run.get(key) is not None and not number(run[key]) for key in TIMES):
        raise ValueError('Invalid timing')
    if not isinstance(run.get('success'), bool):
        raise ValueError('Missing success verdict')
    result = {key: run.get(key) for key in TIMES}
    result.update({key: usage[key] for key in TOKENS})
    result.update({key: run.get(key) for key in ('infrastructureError', 'agentStarted', 'timedOut')})
    result.update(totalTokens=sum(usage[key] for key in TOKENS), success=run['success'], runOrder=run['runOrder'])
    result['totalMeasuredDurationMs'] = sum(result[key] for key in TIMES) if all(result[key] is not None for key in TIMES) else None
    return result


def timing_summary(trace):
    timings = trace.get('toolTimings')
    if timings is None:
        return None
    intervals = []
    missing_start = missing_end = invalid = 0
    for item in timings:
        start, end = item.get('observedStartMs'), item.get('observedEndMs')
        missing_start += start is None
        missing_end += end is None
        if start is None or end is None:
            continue
        if not number(start) or not number(end) or end < start:
            invalid += 1
            continue
        intervals.append((start, end))
    union = 0
    last_end = 0
    for start, end in sorted(intervals):
        union += max(0, end - max(start, last_end))
        last_end = max(last_end, end)
    return {'items': len(timings), 'completeIntervals': len(intervals), 'missingStart': missing_start,
            'missingEnd': missing_end, 'invalidIntervals': invalid,
            'sumObservedMs': sum(end - start for start, end in intervals), 'unionObservedMs': union}


def trace_inventory(directories, manifest_hash):
    inventory, traces = [], []
    for index, directory in enumerate(directories):
        marker = directory / 'manifest-sha256.txt'
        if not marker.is_file() or marker.read_text().strip() != manifest_hash:
            raise ValueError('Trace manifest hash mismatch or missing marker')
        for path in sorted(directory.glob('run-*.json')):
            trace = json.loads(path.read_text())
            order = trace['runOrder']
            if type(order) is not int or order < 1 or path.name != f'run-{order}.json':
                raise ValueError('Invalid trace run order')
            patch = directory / f'run-{order}-original.patch'
            item = {'directoryIndex': index, 'runOrder': order, 'taskId': trace['taskId'], 'mode': trace['mode'],
                    'traceSha256': sha(path), 'originalPatchSha256': sha(patch) if patch.is_file() else None,
                    'selected': False}
            inventory.append(item)
            traces.append((trace, item))
        for patch in sorted(directory.glob('run-*-original.patch')):
            if not (directory / patch.name.replace('-original.patch', '.json')).is_file():
                inventory.append({'directoryIndex': index, 'originalPatchSha256': sha(patch), 'orphanPatch': True, 'selected': False})
    return inventory, traces


def aggregate(pairs):
    totals = {}
    for mode in MODES:
        totals[mode] = {'runs': len(pairs), 'successes': sum(p[mode]['success'] for p in pairs)}
        for key in (*TIMES, *TOKENS, 'totalTokens', 'totalMeasuredDurationMs'):
            values = [p[mode][key] for p in pairs]
            totals[mode][key] = sum(values) if all(v is not None for v in values) else None
        totals[mode]['missingTimingCounts'] = {key: sum(p[mode][key] is None for p in pairs) for key in TIMES}
    comparisons = {}
    for key in ('agentDurationMs', 'totalTokens', 'totalMeasuredDurationMs'):
        comparable = [p for p in pairs if all(p[m][key] is not None for m in MODES)]
        comparisons[key] = {'pairedCount': len(comparable),
                            'codemapLower': sum(p['codemap'][key] < p['baseline'][key] for p in comparable),
                            'codemapHigher': sum(p['codemap'][key] > p['baseline'][key] for p in comparable),
                            'ties': sum(p['codemap'][key] == p['baseline'][key] for p in comparable),
                            'ratioCodemapToBaseline': ratio(totals['codemap'][key], totals['baseline'][key]) if comparable and len(comparable) == len(pairs) else None}
    comparisons['success'] = {'wins': sum(p['codemap']['success'] and not p['baseline']['success'] for p in pairs),
                              'losses': sum(p['baseline']['success'] and not p['codemap']['success'] for p in pairs),
                              'bothPass': sum(all(p[m]['success'] for m in MODES) for p in pairs),
                              'bothFail': sum(not any(p[m]['success'] for m in MODES) for p in pairs)}
    return {'totals': totals, 'paired': comparisons}


def analyze(manifest_path, evidence_path, directories):
    manifest = json.loads(manifest_path.read_text())
    evidence = json.loads(evidence_path.read_text())
    manifest_hash = evidence['manifestSha256']
    inventory, traces = trace_inventory(directories, manifest_hash)
    tasks = {(task['repo'], task['id']) for task in manifest['tasks']}
    if len(tasks) != len(manifest['tasks']):
        raise ValueError('Duplicate manifest task')
    runs = {}
    for run in evidence['results']:
        if run['mode'] not in MODES:
            raise ValueError('Expected baseline/codemap evidence only')
        task = (run['repo'], run['taskId'])
        if task not in tasks or (*task, run['mode']) in runs:
            raise ValueError('Unknown task or duplicate task/mode')
        runs[(*task, run['mode'])] = run
    pairs, missing = [], []
    for repo, task in sorted(tasks):
        if not all((repo, task, mode) in runs for mode in MODES):
            missing.append({'repo': repo, 'taskId': task, 'missingModes': [m for m in MODES if (repo, task, m) not in runs]})
            continue
        pair = {'repo': repo, 'taskId': task}
        for mode in MODES:
            run = runs[(repo, task, mode)]
            pair[mode] = run_metrics(run)
            candidates = [(trace, item) for trace, item in traces if trace['taskId'] == task and trace['mode'] == mode
                          and trace['runOrder'] == run['runOrder'] and run.get('originalPatchSha256')
                          and item['originalPatchSha256'] == run['originalPatchSha256']]
            if len(candidates) > 1:
                raise ValueError('Ambiguous matching traces')
            pair[mode]['traceMatched'] = bool(candidates)
            pair[mode]['originalPatchSha256'] = run.get('originalPatchSha256')
            if candidates:
                trace, item = candidates[0]
                item['selected'] = True
                pair[mode]['toolTiming'] = timing_summary(trace)
                load = trace.get('hostLoad', {})
                samples = [load.get(endpoint) for endpoint in ('before', 'after')]
                if all(isinstance(s, list) and len(s) == 3 and all(number(v) for v in s) for s in samples):
                    pair[mode]['hostLoadRange'] = [[min(s[i] for s in samples), max(s[i] for s in samples)] for i in range(3)]
        pair['ratiosCodemapToBaseline'] = {key: ratio(pair['codemap'][key], pair['baseline'][key]) for key in ('agentDurationMs', 'totalTokens')}
        pairs.append(pair)
    repositories = {}
    for repo in sorted({repo for repo, _ in tasks}):
        subset = [p for p in pairs if p['repo'] == repo]
        repositories[repo] = aggregate(subset)
        repositories[repo]['bootstrap'] = {key: bootstrap(subset, key) for key in ('agentDurationMs', 'totalTokens')} if subset else None
    overall = aggregate(pairs)
    overall['bootstrap'] = {key: bootstrap(pairs, key, stratified=True) for key in ('agentDurationMs', 'totalTokens')} if pairs else None
    selected = [p[m] for p in pairs for m in MODES]
    timings = [r['toolTiming'] for r in selected if r.get('toolTiming') is not None]
    loads = [r['hostLoadRange'] for r in selected if 'hostLoadRange' in r]
    return {'schemaVersion': 1, 'manifestFileSha256': sha(manifest_path), 'manifestSha256': manifest_hash,
            'evidenceFileSha256': sha(evidence_path), 'gate': evidence['gate'],
            **({'efficiencyGate': evidence['efficiencyGate']} if 'efficiencyGate' in evidence else {}),
            'complete': not missing, 'plannedPairs': len(tasks), 'completedPairs': len(pairs), 'missingPairs': missing,
            'repositories': repositories, 'overall': overall, 'tasks': pairs, 'traceInventory': inventory,
            'traceSummary': {'requested': bool(directories), 'matchedRuns': sum(r['traceMatched'] for r in selected),
                             'timedRuns': len(timings), 'toolTiming': {k: sum(t[k] for t in timings) for k in timings[0]} if timings else None,
                             'hostLoadRuns': len(loads), 'hostLoadRange': [[min(r[i][0] for r in loads), max(r[i][1] for r in loads)] for i in range(3)] if loads else None},
            'method': {'ratio': 'codemap / baseline; ratios of sums', 'bootstrap': '10000 paired task draws with replacement within each repo, retaining stratum sizes; overall ratio of sums across resampled repos; seed 20260907 reset per metric/summary; linear percentile 95% interval',
                       'tokens': 'normalized input + cache read + cache creation + output; cache counted once',
                       'timing': 'tool timings measure JSONL reception; union per run, then summed; missing endpoints excluded; no inference of model-only time',
                       'manifest': 'manifestFileSha256 hashes supplied bytes; manifestSha256 is the runner stable-JSON hash copied from evidence, not recomputed',
                       'scope': 'completed pairs including failures; unpaired runs and superseded infrastructure excluded; original gate unchanged'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('manifest', 'evidence', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--trace-dir', action='append', type=Path, default=[])
    args = parser.parse_args()
    report = analyze(args.manifest, args.evidence, args.trace_dir)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
