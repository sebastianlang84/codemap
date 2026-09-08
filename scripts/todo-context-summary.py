"""Compare a completed prototype with the unchanged context baseline."""
import json
import sys
from pathlib import Path
base = json.loads(Path(sys.argv[1]).read_text())
result = json.loads(Path(sys.argv[2]).read_text())
assert base['manifestSha256'] == result['manifestSha256']
assert [c['id'] for c in base['cases']] == [c['id'] for c in result['cases']]
pairs = list(zip(base['cases'], result['cases']))
summary = {
    'completeTargets': result['summary']['completeTargets'],
    'completeTaskPackages': result['summary']['completeTaskPackages'],
    'targetWins': [a['id'] for a, b in pairs if not a['completeTargets'] and b['completeTargets']],
    'targetLosses': [a['id'] for a, b in pairs if a['completeTargets'] and not b['completeTargets']],
    'packageLosses': [a['id'] for a, b in pairs if a['completeTaskPackage'] and not b['completeTaskPackage']],
    'byteReduction': 1 - sum(c['sourceBytes'] for c in result['cases']) / sum(c['sourceBytes'] for c in base['cases']),
    'sourceAndBudgetChecks': result['summary']['allSourceIntegrity'] and result['summary']['allBudgetsPreserved'],
    'uncertainCases': [c['id'] for c in result['cases'] if c.get('experimentalUncertain')],
    'variantAnchorChanges': [c['id'] for c in result['cases'] if c.get('experimentalAnchors') and len({r['hits'][0]['path'] if r['hits'] else None for r in c['experimentalAnchors']}) > 1],
}
print(json.dumps(summary, indent=2))
