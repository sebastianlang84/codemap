"""Audit existing private traces without model calls; run from the repository root."""

import hashlib
import json
from pathlib import Path

inventory = json.loads(Path('docs/developer/agent-impact-luna-traces.json').read_text())
archive = Path(inventory['privateArchive'])
rows = []
for entry in inventory['traces']:
    raw = (archive / entry['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError(f"Trace hash mismatch: {entry['file']}")
    trace = json.loads(raw)
    events = [json.loads(line) for line in trace['stdout'].splitlines() if line.strip()]
    commands = [
        event['item'] for event in events
        if event.get('type') == 'item.completed'
        and event.get('item', {}).get('type') == 'command_execution'
    ]
    outputs = [command.get('aggregated_output', '') for command in commands]
    rows.append({
        'runOrder': entry['runOrder'],
        'taskId': trace['taskId'],
        'mode': trace['mode'],
        'commands': len(commands),
        'rgMissingEvents': sum('rg: command not found' in output for output in outputs),
        'outputCharacters': sum(map(len, outputs)),
        'largeOutputs': [
            {'commandOrdinal': ordinal, 'characters': len(output)}
            for ordinal, output in enumerate(outputs, 1) if len(output) >= 60000
        ],
    })

if len(rows) != 16 or sum(row['commands'] for row in rows) != 210:
    raise ValueError('Unexpected frozen trace inventory')

result = {
    'sourceInventory': 'agent-impact-luna-traces.json',
    'method': (
        'SHA-256 verified traces; completed command events; Unicode character counts '
        'of recorded aggregated_output, not model tokens. Large output threshold: '
        '60000 characters. Ordinals are one-based within each run.'
    ),
    'runs': rows,
}
Path('docs/developer/agent-impact-luna-navigation.json').write_text(
    json.dumps(result, indent=2) + '\n'
)
