"""Summarize hash-verified private traces; run from the repository root."""

import hashlib
import json
from collections import Counter
from pathlib import Path

inventory_path = Path('docs/developer/agent-impact-context-traces.json')
inventory = json.loads(inventory_path.read_text())
report = json.loads(Path('docs/developer/agent-impact-context-result.json').read_text())
rows = []
for entry in inventory['traces']:
    raw = (Path(inventory['privateArchive']) / entry['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError(f"Trace hash mismatch: {entry['file']}")
    trace = json.loads(raw)
    events = [json.loads(line) for line in trace['stdout'].splitlines() if line.strip()]
    commands = [event['item'] for event in events
                if event.get('type') == 'item.completed'
                and event.get('item', {}).get('type') == 'command_execution']
    outputs = [command.get('aggregated_output', '') for command in commands]
    counts = Counter(command['command'] for command in commands)
    completed = [event for event in events if event.get('type') == 'turn.completed']
    if len(completed) != 1:
        raise ValueError(f"Expected one completed turn: {entry['file']}")
    recorded = next(row for row in report['results'] if row['runOrder'] == trace['runOrder'])
    usage = completed[0]['usage']
    if recorded['taskId'] != trace['taskId'] or recorded['mode'] != trace['mode']:
        raise ValueError('Trace/report identity mismatch')
    expected_input = sum(recorded['usage'][key] for key in [
        'inputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'])
    if usage['input_tokens'] != expected_input or usage['output_tokens'] != recorded['usage']['outputTokens']:
        raise ValueError('Trace/report token mismatch')
    rows.append({
        'runOrder': trace['runOrder'], 'taskId': trace['taskId'], 'mode': trace['mode'],
        'commands': len(commands),
        'rgMissingEvents': sum('rg: command not found' in output for output in outputs),
        'outputCharacters': sum(map(len, outputs)),
        'exactRepeatedCommands': sum(count - 1 for count in counts.values()),
        'largeOutputs': [{'commandOrdinal': ordinal, 'characters': len(output)}
                         for ordinal, output in enumerate(outputs, 1)
                         if len(output) >= 60000],
        'usage': usage,
    })

comparison = report['diagnostic']['curatedVsBaseline']
faster_tasks = sum(
    curated['agentDurationMs'] < baseline['agentDurationMs']
    for curated in report['results'] if curated['mode'] == 'curated' and not curated.get('infrastructureError')
    for baseline in report['results'] if baseline['mode'] == 'baseline'
    and baseline['taskId'] == curated['taskId'] and not baseline.get('infrastructureError')
)
checks = {
    'allFourTripletsValid': report['diagnostic']['complete'],
    'noPairedSuccessLosses': comparison['losses'] == 0,
    'agentTimeRatioAtMost085': comparison['agentDurationRatio'] is not None and comparison['agentDurationRatio'] <= 0.85,
    'totalTokenRatioAtMost110': comparison['tokenRatio'] is not None and comparison['tokenRatio'] <= 1.10,
    'atLeastThreeFasterTasks': faster_tasks >= 3,
}
result = {
    'sourceInventory': inventory_path.name,
    'method': ('SHA-256 verified traces; completed command events; Unicode character counts '
               'of recorded output, not model tokens. Exact repeated commands include tests '
               'and are not classified as avoidable reads. Large output threshold: 60000 '
               'characters. One-based command ordinals; no per-event timing.'),
    'runs': rows,
    'frozenDirectionalSignal': {
        'comparison': 'curated versus baseline', 'passed': all(checks.values()),
        'checks': checks, 'fasterTasks': faster_tasks,
        'claimBoundary': 'Diagnostic signal only; faster failed tasks count, and test scope varies.',
    },
}
Path('docs/developer/agent-impact-context-navigation.json').write_text(
    json.dumps(result, indent=2) + '\n')
