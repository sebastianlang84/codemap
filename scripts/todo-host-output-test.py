"""Check payload evidence without starting a host or provider."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('todo-host-output.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class EvidenceTests(unittest.TestCase):
    def test_user_text_is_not_tool_evidence(self):
        payload = {'messages': [{'role': 'user', 'content': probe.SOURCE}]}
        self.assertFalse(probe.analyze_payload(payload, 'pi')['sourceInFollowup'])

    def test_pi_json_tool_content_contains_full_source(self):
        payload = {'messages': [{'role': 'tool', 'content': json.dumps({'readFirst': [{'text': probe.SOURCE}]})}]}
        result = probe.analyze_payload(payload, 'pi')
        self.assertTrue(result['sourceInFollowup'])
        self.assertTrue(result['markerInFollowup'])
        self.assertFalse(result['hasStructuredContent'])

    def test_codex_structured_mcp_result_forwarded_as_text(self):
        value = {'content': [{'type': 'text', 'text': 'probe.ts:1-48'}],
                 'structuredContent': {'readFirst': [{'text': probe.SOURCE}]}}
        payload = {'input': [{'type': 'custom_tool_call_output', 'output': [{'type': 'input_text', 'text': json.dumps(value)}]}]}
        result = probe.analyze_payload(payload, 'codex')
        self.assertTrue(result['sourceInFollowup'])
        self.assertTrue(result['hasStructuredContent'])

    def test_summary_and_unsupported_call_do_not_count_as_full_source(self):
        for text in ('probe.ts:1-48 [function]', 'unsupported call: codemap_context', probe.SOURCE[:700]):
            payload = {'input': [{'type': 'function_call_output', 'output': text}]}
            self.assertFalse(probe.analyze_payload(payload, 'codex')['sourceInFollowup'])


if __name__ == '__main__':
    unittest.main()
