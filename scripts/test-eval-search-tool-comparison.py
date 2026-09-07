"""Synthetic checks for comparison parsing, source budgets and continuation gates."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('comparison', Path(__file__).with_name('eval-search-tool-comparison.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ComparisonTests(unittest.TestCase):
    def test_rg_limits_native_text_and_first_match(self):
        events = []
        for path in ('./a.py', './b.py'):
            for line in range(1, 5):
                events.append(json.dumps({'type': 'match', 'data': {
                    'path': {'text': path}, 'line_number': line,
                    'lines': {'text': f'  α{line}\n'}}}))
        candidates, native = m.parse_rg('\n'.join(events).encode(), limit=1, matches=3)
        self.assertEqual(candidates, [{'path': 'a.py', 'startLine': 1, 'endLine': 1}])
        self.assertEqual(native, 'a.py:1:  α1\na.py:2:  α2\na.py:3:  α3\n')

    def test_pgr_uses_first_displayed_match_not_smallest_line(self):
        native = ('  summary:\n    best_next_step: read a.py around line 4\n\n'
                  './a.py\n  why: source, definition\n  8-8:\n    8| def x():\n'
                  '  2-2:\n    2| x()\n\nb.py\n  why: test\n  1-1:\n    1| x()\n'
                  '  note: truncated to top 2 files; refine query')
        self.assertEqual([(c['path'], c['startLine']) for c in m.parse_pgr(native)], [('a.py', 8), ('b.py', 1)])
        self.assertEqual(m.parse_pgr('No matches found.\n  query: z'), [])
        with self.assertRaises(ValueError):
            m.parse_pgr('Unexpected output')

    def test_reader_unicode_whole_lines_and_stops_without_skipping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a').write_text('α\n' + 'β' * 8 + '\n')
            (root / 'b').write_text('x\n')
            settings = dict(readFiles=8, readLines=160, readBefore=40, sourceBytes=6)
            spans = m.read_spans(root, [{'path': 'a', 'startLine': 1}, {'path': 'b', 'startLine': 1}], settings)
            self.assertEqual(len(spans), 1)
            self.assertEqual(spans[0]['text'], 'α\n')
            self.assertEqual(spans[0]['sourceBytes'], 3)
            self.assertTrue(spans[0]['sourceMatchesSpan'])
            with self.assertRaises(ValueError):
                m.read_spans(root, [{'path': '../missing', 'startLine': 1}], settings)

    def test_reader_offsets_and_file_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a').write_text(''.join(f'{i}\n' for i in range(1, 301)))
            spans = m.read_spans(root, [{'path': 'a', 'startLine': 100}],
                                 dict(readFiles=8, readLines=160, readBefore=40, sourceBytes=16384))
            self.assertEqual((spans[0]['startLine'], spans[0]['endLine']), (60, 219))

    def test_metrics_separate_targets_and_packages(self):
        candidates = [{'path': p} for p in ['noise', 'source', 'test']]
        targets = [{'path': 'source', 'startLine': 3, 'endLine': 7}]
        result = m.metrics(candidates, ['source', 'test'], targets,
                           [{'path': 'source', 'startLine': 1, 'endLine': 7}])
        self.assertEqual(result['mrr'], .5)
        self.assertTrue(result['allGoldAt5'])
        self.assertTrue(result['completeTargetCase'])
        self.assertFalse(result['completePackageCase'])
        partial = m.metrics(candidates, ['source', 'test'], targets,
                            [{'path': 'source', 'startLine': 1, 'endLine': 6}])
        self.assertFalse(partial['completeTargetCase'])

    def test_gates_reject_losses_bytes_and_missing_pairs(self):
        def rows(control, treatment):
            return [{'track': 'regex', 'id': str(i), 'profile': profile,
                     'metrics': dict(allGoldAt5=value, mrr=float(value), recall5=float(value), recall10=float(value)),
                     'nativeResponseBytes': 10, 'medianMs': 1, 'stableResults': True}
                    for profile, values in [('rg', control), ('pgr', treatment)] for i, value in enumerate(values)]
        good = rows([False, False, True], [True, True, True])
        self.assertTrue(m.summarize(good)['continuationGates']['pgr']['passed'])
        lost = rows([False, False, False, True], [True, True, True, False])
        self.assertFalse(m.summarize(lost)['continuationGates']['pgr']['passed'])
        good[-1]['nativeResponseBytes'] = 14
        self.assertFalse(m.summarize(good)['continuationGates']['pgr']['passed'])
        self.assertFalse(m.summarize(good[:-1])['continuationGates']['pgr']['passed'])

    def test_bm25_gate_requires_complete_spans_and_recall(self):
        rows = [{'track': 'term', 'id': str(i), 'profile': profile,
                 'metrics': dict(allGoldAt5=False, mrr=1, recall5=.5, recall10=1,
                                 completeTargetCase=profile == 'bm25', completePackageCase=False),
                 'nativeResponseBytes': 10, 'medianMs': 1, 'stableResults': True}
                for profile in ('bm25', 'codemap_fts') for i in range(2)]
        self.assertTrue(m.summarize(rows)['continuationGates']['bm25']['passed'])
        rows[0]['metrics']['recall5'] = .4
        self.assertFalse(m.summarize(rows)['continuationGates']['bm25']['passed'])
        rows[0]['metrics']['recall5'] = .5
        rows[0]['metrics']['completeTargetCase'] = False
        self.assertFalse(m.summarize(rows)['continuationGates']['bm25']['passed'])

    def test_invalid_rg_pattern_raises_instead_of_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a.py').write_text('x\n')
            with self.assertRaises(RuntimeError):
                m.command(['rg', '--json', '--', '[', '.'], root, allowed=(0, 1))
            raw, _ = m.command(['rg', '--json', '--', 'missing', '.'], root, allowed=(0, 1))
            self.assertEqual(m.parse_rg(raw)[0], [])


if __name__ == '__main__':
    unittest.main()
