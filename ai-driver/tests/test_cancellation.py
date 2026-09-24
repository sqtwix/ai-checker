import json
import os
import tempfile
import unittest
import uuid
from unittest.mock import Mock, patch
from fastapi import HTTPException
from backend.cancellation import AnalysisCancelled, cancel_job, check_cancelled, job_context
from backend.agent_manager import AgentManager
from controllers.agent_controller import AgentController
from schemas.analysis_request import AnalysisRequest
from test_full_analysis import source_data, responding_factory


class CancellationTests(unittest.TestCase):
    def test_cancel_before_start_does_not_call_model_or_return_fallback(self):
        source = source_data(2)
        source["batch_id"] = str(uuid.uuid4())
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AI_CHECKPOINT_DIR": directory, "ALLOW_PROGRAMMATIC_FALLBACK": "true"}):
            cancel_job(source["batch_id"])
            factory, main, _, _ = responding_factory()
            controller = AgentController(AgentManager(factory))
            with self.assertRaises(HTTPException) as error:
                controller.get_local_llm_data_analysis(AnalysisRequest.model_validate(source))
            self.assertEqual(409, error.exception.status_code)
            main.execute.assert_not_called()

    def test_cancel_during_part_stops_before_next_part_and_is_job_scoped(self):
        source = source_data(9)
        source["batch_id"] = str(uuid.uuid4())
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AI_CHECKPOINT_DIR": directory}):
            factory, main, anomaly, summary = responding_factory()
            normal = main.execute.side_effect
            def cancel_after_response(*args, **kwargs):
                cancel_job(source["batch_id"])
                return normal(*args, **kwargs)
            main.execute.side_effect = cancel_after_response
            with self.assertRaises(AnalysisCancelled):
                AgentManager(factory).start_local_llm_processing(json.dumps(source))
            self.assertEqual(1, main.execute.call_count)
            anomaly.execute.assert_not_called()
            summary.execute.assert_not_called()
            # Persistent marker is respected by a fresh pipeline too.
            with self.assertRaises(AnalysisCancelled), job_context(source["batch_id"]):
                check_cancelled()
            with job_context(str(uuid.uuid4())):
                check_cancelled()
