import os
import unittest
from unittest.mock import Mock, patch

from backend.agent_factory import AgentFactory
from backend.model_availability import get_model_availability, local_model_available, verify_local_inference


class ModelAvailabilityTests(unittest.TestCase):
    def test_no_ai_is_a_valid_mode(self):
        with patch.dict(os.environ, {}, clear=True):
            availability = get_model_availability()
        self.assertFalse(availability["deepseek"]["available"])
        self.assertFalse(availability["gigachat"]["available"])
        self.assertFalse(availability["local_llm"]["available"])

    def test_local_provider_uses_canonical_environment(self):
        with patch.dict(os.environ, {
            "LOCAL_LLM_BASE_URL": "http://model.example/v1",
            "LOCAL_LLM_MODEL": "approved-model",
        }, clear=True):
            agent = AgentFactory().create_queue("local_llm")[0]
        self.assertEqual("http://model.example/v1", agent.base_url)
        self.assertEqual("approved-model", agent.model)

    @patch("backend.model_availability.httpx.get")
    def test_models_probe_is_required(self, get):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": [{"id": "approved-model"}]}
        get.return_value = response
        with patch.dict(os.environ, {
            "ENABLE_LOCAL_LLM": "true",
            "LOCAL_LLM_BASE_URL": "http://model.example/v1",
            "LOCAL_LLM_MODEL": "approved-model",
        }, clear=True):
            self.assertTrue(local_model_available())

    @patch("backend.model_availability.httpx.post")
    @patch("backend.model_availability.httpx.get")
    def test_inference_probe_requires_nonempty_completion(self, get, post):
        models = Mock()
        models.raise_for_status.return_value = None
        models.json.return_value = {"data": [{"id": "approved-model"}]}
        get.return_value = models
        completion = Mock()
        completion.raise_for_status.return_value = None
        completion.json.return_value = {"choices": [{"message": {"content": "готов"}}]}
        post.return_value = completion
        with patch.dict(os.environ, {
            "ENABLE_LOCAL_LLM": "true",
            "LOCAL_LLM_BASE_URL": "http://model.example/v1",
            "LOCAL_LLM_MODEL": "approved-model",
        }, clear=True):
            self.assertTrue(verify_local_inference())


if __name__ == "__main__":
    unittest.main()
