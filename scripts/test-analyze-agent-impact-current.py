"""Synthetic checks; never opens a benchmark manifest or real trace."""
import importlib.util
import json
from pathlib import Path
import tempfile
import sys

sys.dont_write_bytecode = True
import unittest

spec = importlib.util.spec_from_file_location('analysis', Path(__file__).with_name('analyze-agent-impact-current.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class AnalysisTests(unittest.TestCase):
    def test_paired_bootstrap(self):
        pairs = [{'baseline': {'value': b}, 'codemap': {'value': b * 2}} for b in (10, 30, 100)]
        result = a.bootstrap(pairs, 'value')
        self.assertEqual(result['percentile95'], [2, 2])
        self.assertEqual(result['validDraws'], 10000)
        pairs[0]['codemap']['value'] = 1
        self.assertEqual(a.bootstrap(pairs, 'value'), a.bootstrap(pairs, 'value'))
        self.assertEqual(a.percentile([1, 2, 3, 4], .25), 1.75)

    def test_stratified_overall_preserves_repo_weights(self):
        pairs = [{'repo': repo, 'baseline': {'value': base}, 'codemap': {'value': treated}}
                 for repo, base, treated in [('a', 10, 100), ('b', 100, 100), ('b', 100, 100)]]
        result = a.bootstrap(pairs, 'value', stratified=True)
        self.assertEqual(result['stratumSizes'], [1, 2])
        self.assertEqual(result['percentile95'], [300 / 210, 300 / 210])
        self.assertNotEqual(result['percentile95'], a.bootstrap(pairs, 'value')['percentile95'])
        self.assertNotEqual(result['percentile95'][0], (10 + 1 + 1) / 3)

    def test_overlap_and_missing(self):
        trace = {'toolTimings': [{'observedStartMs': s, 'observedEndMs': e, 'command': 'SECRET'}
                                for s, e in [(0, 10), (5, 20), (30, 40), (None, 50), (60, None), (90, 80)]]}
        result = a.timing_summary(trace)
        self.assertEqual(result['sumObservedMs'], 35)
        self.assertEqual(result['unionObservedMs'], 30)
        self.assertEqual(result['missingStart'], 1)
        self.assertEqual(result['missingEnd'], 1)
        self.assertEqual(result['invalidIntervals'], 1)
        self.assertNotIn('SECRET', json.dumps(result))

    def test_report_and_resume_inventory(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            manifest = root / 'manifest.json'
            evidence = root / 'evidence.json'
            manifest.write_text(json.dumps({'tasks': [{'repo': 'one', 'id': 'a'}, {'repo': 'two', 'id': 'b'}]}))
            runs = []
            directories = [root / 'old', root / 'resumed']
            for directory in directories:
                directory.mkdir()
                (directory / 'manifest-sha256.txt').write_text('canonical-hash\n')
            for index, (repo, task) in enumerate([('one', 'a'), ('two', 'b')]):
                for mode in a.MODES:
                    order = len(runs) + 1
                    factor = (2 if repo == 'one' else 3) if mode == 'codemap' else 1
                    directory = directories[1]
                    patch = directory / f'run-{order}-original.patch'
                    patch.write_text(f'private original patch {order}')
                    run = {'repo': repo, 'taskId': task, 'mode': mode, 'runOrder': order,
                           'usage': {'inputTokens': 10 * factor, 'cacheReadInputTokens': 20 * factor,
                                     'cacheCreationInputTokens': 5 * factor, 'outputTokens': 5 * factor},
                           **{key: 10 * factor for key in a.TIMES}, 'success': mode == 'baseline', 'agentStarted': True, 'timedOut': False,
                           'infrastructureError': 'synthetic failure' if mode == 'codemap' else None,
                           'originalPatchSha256': a.sha(patch)}
                    runs.append(run)
                    trace = {'taskId': task, 'mode': mode, 'runOrder': order, 'stdout': 'SECRET', 'stderr': 'SECRET',
                             'hostLoad': {'before': [1, 2, 3], 'after': [2, 3, 4]},
                             'toolTimings': [{'observedStartMs': 0, 'observedEndMs': 10, 'command': 'SECRET'}]}
                    (directory / f'run-{order}.json').write_text(json.dumps(trace))
                    if order == 1:
                        (directories[0] / f'run-{order}.json').write_text(json.dumps(trace))
                        (directories[0] / f'run-{order}-original.patch').write_text('superseded patch')
            original = {'manifestSha256': 'canonical-hash', 'results': runs, 'gate': {'passed': False, 'issues': ['original']}}
            evidence.write_text(json.dumps(original))
            report = a.analyze(manifest, evidence, directories)
            self.assertTrue(report['complete'])
            self.assertTrue(report['overall']['bootstrap']['totalTokens']['stratifiedByRepo'])
            self.assertEqual(report['tasks'][0]['codemap']['infrastructureError'], 'synthetic failure')
            self.assertTrue(report['tasks'][0]['baseline']['agentStarted'])
            self.assertFalse(report['tasks'][0]['baseline']['timedOut'])
            self.assertEqual(report['gate'], original['gate'])
            self.assertEqual(report['completedPairs'], 2)
            self.assertEqual(report['tasks'][0]['baseline']['totalTokens'], 40)
            self.assertEqual(report['repositories']['one']['bootstrap']['totalTokens']['percentile95'], [2, 2])
            self.assertEqual(report['repositories']['two']['bootstrap']['totalTokens']['percentile95'], [3, 3])
            self.assertEqual(report['overall']['paired']['success']['losses'], 2)
            self.assertEqual(report['traceSummary']['matchedRuns'], 4)
            self.assertEqual(len(report['traceInventory']), 5)
            self.assertEqual(report['traceSummary']['toolTiming']['unionObservedMs'], 40)
            self.assertEqual(report['traceSummary']['hostLoadRange'], [[1, 2], [2, 3], [3, 4]])
            self.assertNotIn('SECRET', json.dumps(report))
            self.assertNotIn('private original', json.dumps(report))
            self.assertEqual(report['evidenceFileSha256'], a.sha(evidence))
            del original['results'][0]['setupDurationMs']
            original['results'].pop()
            evidence.write_text(json.dumps(original))
            report = a.analyze(manifest, evidence, [])
            self.assertFalse(report['complete'])
            self.assertEqual(report['overall']['totals']['baseline']['missingTimingCounts']['setupDurationMs'], 1)
            self.assertIsNone(report['overall']['totals']['baseline']['totalMeasuredDurationMs'])
            original['results'].append(original['results'][0])
            evidence.write_text(json.dumps(original))
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                a.analyze(manifest, evidence, [])


if __name__ == '__main__':
    unittest.main()
