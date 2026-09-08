"""Audit visible CLI context and exact excerpt rereads; never infer avoidable time."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex


def shell_body(command):
    try:
        words = shlex.split(command)
        return words[-1] if len(words) >= 3 and words[-2] in ('-c', '-lc') else command
    except ValueError:
        return command


def audit(trace):
    known = []
    rows = []
    edited = False
    for line in trace['stdout'].splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get('type') != 'item.completed':
            continue
        item = event.get('item', {})
        if item.get('type') == 'file_change':
            edited = True
        if item.get('type') != 'command_execution':
            continue
        command = shell_body(item.get('command', ''))
        output = item.get('aggregated_output', '')
        context = bool(re.search(r'\bcodemap\s+context\b', command))
        search = bool(re.search(r'\bcodemap\s+search\b', command))
        ordinary = bool(re.search(r'(?:^|[;&|]\s*)(?:rg|grep|sed|cat|head|tail|find|ls)\b', command))
        row = {'ordinal': len(rows) + 1, 'beforeRecordedEdit': not edited,
               'context': context, 'search': search, 'ordinaryNavigation': ordinary,
               'exitCode': item.get('exit_code'), 'outputBytes': len(output.encode()),
               'outputSha256': hashlib.sha256(output.encode()).hexdigest(),
               'truncationMarker': bool(re.search(r'output truncated|tokens truncated|truncated output', output, re.I)),
               'sourceExcerpts': 0, 'completeExcerptRereads': []}
        if ordinary and not context and not edited:
            for path, text, start, end in known:
                path_token = re.search(r'(?<![\w./-])' + re.escape(path) + r'(?![\w./-])', command)
                if path_token and text and text in output:
                    row['completeExcerptRereads'].append({'path': path, 'startLine': start, 'endLine': end,
                        'sourceSha256': hashlib.sha256(text.encode()).hexdigest()})
        if context and item.get('exit_code') == 0:
            try:
                value, _ = json.JSONDecoder().raw_decode(output.lstrip())
            except ValueError:
                value = {}
            if isinstance(value, dict):
                for excerpt in value.get('readFirst', []):
                    if isinstance(excerpt.get('text'), str) and excerpt['text']:
                        known.append((excerpt['path'], excerpt['text'], excerpt.get('startLine'), excerpt.get('endLine')))
                        row['sourceExcerpts'] += 1
        rows.append(row)
    return {'taskId': trace['taskId'], 'mode': trace['mode'], 'runOrder': trace['runOrder'],
            'commands': len(rows), 'ordinaryNavigationBeforeRecordedEdit': sum(r['ordinaryNavigation'] and r['beforeRecordedEdit'] for r in rows),
            'fullExcerptRereadCommands': sum(bool(r['completeExcerptRereads']) for r in rows),
            'contextCalls': sum(r['context'] for r in rows), 'contextCallsWithSource': sum(r['sourceExcerpts'] > 0 for r in rows),
            'navigationOutputBytes': sum(r['outputBytes'] for r in rows if r['ordinaryNavigation'] or r['context'] or r['search']),
            'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--trace-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text())
    assert (args.trace_dir / 'manifest-sha256.txt').read_text().strip() == evidence['manifestSha256']
    audits = []
    for run in evidence['results']:
        path = args.trace_dir / f"run-{run['runOrder']}.json"
        trace = json.loads(path.read_text())
        assert all(trace[key] == run[key] for key in ('taskId', 'mode', 'runOrder'))
        patch = args.trace_dir / f"run-{run['runOrder']}-original.patch"
        assert hashlib.sha256(patch.read_bytes()).hexdigest() == run['originalPatchSha256']
        audits.append({**audit(trace), 'traceSha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    metrics = ('commands', 'ordinaryNavigationBeforeRecordedEdit', 'fullExcerptRereadCommands',
               'contextCalls', 'contextCallsWithSource', 'navigationOutputBytes')
    result = {'schemaVersion': 1, 'manifestSha256': evidence['manifestSha256'],
              'evidenceSha256': hashlib.sha256(args.evidence.read_bytes()).hexdigest(),
              'totals': {mode: {metric: sum(a[metric] for a in audits if a['mode'] == mode) for metric in metrics}
                         for mode in ('baseline', 'search', 'codemap')}, 'runs': audits,
              'boundary': 'Completed command output only. Ordinary navigation uses literal shell-command patterns. Exact whole-excerpt repetition requires its path in the command and bytes in output, before the first recorded file_change. Shell writes and host-internal truncation are not fully observable. Neither necessity, avoidability nor saved time is inferred; partial overlaps are excluded.'}
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
