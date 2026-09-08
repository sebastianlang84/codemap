"""Budget and metric invariants for the frozen ablation reader."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('rules', Path(__file__).with_name('todo-rules.py'))
rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rules)


class ReaderTests(unittest.TestCase):
    def test_stops_at_expensive_line_without_skipping_to_next_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a.ts').write_text('abc\nexpensive\n')
            (root / 'b.ts').write_text('x\n')
            candidates = [{'path': 'a.ts', 'startLine': 1, 'endLine': 3},
                          {'path': 'b.ts', 'startLine': 1, 'endLine': 2}]
            self.assertEqual([(s['path'], s['endLine'], s['sourceBytes']) for s in rules.context_spans(root, candidates, 7)],
                             [('a.ts', 1, 4)])

    def test_utf8_and_final_empty_line(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a.ts').write_text('ö\nx\n')
            candidates = [{'path': 'a.ts', 'startLine': 1, 'endLine': 3}]
            self.assertEqual(rules.context_spans(root, candidates, 3)[0]['endLine'], 1)
            result = rules.context_spans(root, candidates, 5)[0]
            self.assertEqual((result['endLine'], result['sourceBytes']), (3, 5))

    def test_empty_indexed_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'empty.py').write_text('')
            result = rules.context_spans(root, [{'path': 'empty.py', 'startLine': 1, 'endLine': 1}])
            self.assertEqual(result[0]['sourceBytes'], 0)

    def test_path_presence_does_not_certify_complete_target(self):
        metrics = rules.comparison.metrics([{'path': 'a.ts'}], ['a.ts'],
                                          [{'path': 'a.ts', 'startLine': 5, 'endLine': 9}],
                                          [{'path': 'a.ts', 'startLine': 1, 'endLine': 6}])
        self.assertEqual(metrics['recall5'], 1)
        self.assertFalse(metrics['completeTargetCase'])


if __name__ == '__main__':
    unittest.main()
