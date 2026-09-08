import importlib.util
from pathlib import Path
import json
import unittest

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('analyze-todo-navigation.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AuditTests(unittest.TestCase):
    def test_visible_full_source_is_required(self):
        def run(source, edited=False):
            events = [{'type': 'item.completed', 'item': {'type': 'command_execution', 'command': 'codemap context x.ts --json',
                       'exit_code': 0, 'aggregated_output': json.dumps({'readFirst': [{'path': 'x.ts', 'text': source, 'startLine': 1, 'endLine': 2}]})}}]
            if edited:
                events.append({'type': 'item.completed', 'item': {'type': 'file_change'}})
            events.append({'type': 'item.completed', 'item': {'type': 'command_execution', 'command': '/bin/bash -lc "cat x.ts"',
                           'exit_code': 0, 'aggregated_output': 'alpha\nbeta\n'}})
            return module.audit({'taskId': 'one', 'mode': 'codemap', 'runOrder': 1, 'stdout': '\n'.join(map(json.dumps, events))})
        self.assertEqual(run('alpha\nbeta')['fullExcerptRereadCommands'], 1)
        self.assertEqual(run('')['fullExcerptRereadCommands'], 0)
        self.assertEqual(run('alpha\nbeta\ngamma')['fullExcerptRereadCommands'], 0)
        self.assertEqual(run('alpha\nbeta', edited=True)['fullExcerptRereadCommands'], 0)


if __name__ == '__main__':
    unittest.main()
