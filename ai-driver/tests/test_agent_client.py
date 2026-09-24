import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.agent_client import AgentClient, AgentSemanticError


class AgentClientTests(unittest.TestCase):
    def execute_with_response(self, content, finish_reason="stop"):
        with patch("backend.agent_client.OpenAI") as sdk:
            sdk.return_value.chat.completions.create.return_value = SimpleNamespace(
                choices=[SimpleNamespace(
                    message=SimpleNamespace(content=content), finish_reason=finish_reason,
                )],
            )
            agent = AgentClient("test", "http://model.test/v1", "local-model", "main-analyzer")
            result = agent.execute("Return JSON", "Input")
            return result, sdk.return_value.chat.completions.create.call_args.kwargs

    def test_configured_output_budget_is_not_silently_capped_per_role(self):
        with patch.dict(os.environ, {"AI_MAX_OUTPUT_TOKENS": "1000"}):
            _, request = self.execute_with_response('{"status":"ok"}')
        self.assertEqual(1000, request["max_tokens"])

    def test_length_stop_is_rejected_even_if_partial_output_is_valid_json(self):
        with self.assertRaises(AgentSemanticError):
            self.execute_with_response('{"status":"ok"}', finish_reason="length")

    def test_unfinished_json_is_not_repaired_into_a_successful_report(self):
        with self.assertRaises(AgentSemanticError):
            self.execute_with_response('{"status":"unfinished')


if __name__ == "__main__":
    unittest.main()
