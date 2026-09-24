import copy
import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend.agent_client import AgentTransportError
from backend.agent_manager import AgentManager
from backend.full_analysis import FullAnalysisPipeline, compact
from controllers.agent_controller import AgentController
from schemas.analysis_request import AnalysisRequest
from schemas.analysis_response import AnalysisResponse
from test_full_analysis import source_data, responding_factory


def enrich(source, details=None, anomalies=None):
    return AgentController(Mock())._enrich_and_complete_response(
        AnalysisResponse(batch_id="result", global_course_summary="Сводка.",
                         student_detailed_analyses=details or [], anomalies=anomalies or []),
        AnalysisRequest.model_validate(source),
    )


class DataIntegrityTests(unittest.TestCase):
    def test_repeated_attempts_keep_their_grade_and_explanation(self):
        source = source_data(2)
        first, second = source["tests"][0]["student_attempts"]
        second["student_id"] = first["student_id"]
        first["answers"][0]["is_correct_by_lms"] = True
        result = enrich(source, [{
            "student_id": first["student_id"], "test_name": "Тест", "attempt_id": "attempt_2",
            "question_id": "q1", "ai_score_percent": 75, "uniqueness_status": "Normal",
            "error_explanation": "Во второй попытке выбран другой вариант.",
        }])
        self.assertEqual([100, 0], [row.ai_score_percent for row in result.student_detailed_analyses])
        self.assertEqual(["attempt_1", "attempt_2"], [row.attempt_id for row in result.student_detailed_analyses])
        self.assertIn("Во второй", result.student_detailed_analyses[1].error_explanation)
        self.assertIn("50%", result.global_course_summary)

    def test_two_attempts_of_one_person_do_not_prove_a_match_between_people(self):
        source = source_data(2)
        first, second = source["tests"][0]["student_attempts"]
        second["student_id"] = first["student_id"]
        second["answers"] = copy.deepcopy(first["answers"])
        self.assertEqual([], FullAnalysisPipeline.source_events(source)[0])
        result = enrich(source, anomalies=[{
            "student_id": first["student_id"], "anomaly_type": "SuspiciousMatch",
            "severity": "High", "description": "Совпадение ответов.",
        }])
        self.assertEqual([], result.anomalies)
        self.assertTrue(all(row.uniqueness_status == "Normal" for row in result.student_detailed_analyses))

    def test_empty_attempt_is_not_an_incorrect_answer_but_graded_empty_text_is(self):
        source = source_data(3)
        attempts = source["tests"][0]["student_attempts"]
        attempts[0]["answers"] = []
        attempts[1]["answers"][0]["user_answer"] = ""
        attempts[2]["answers"][0]["is_correct_by_lms"] = True
        source["data_notes"] = ["Пустая позиция исключена."]
        source["input_warnings"] = ["Проверьте эталон."]
        result = enrich(source)
        self.assertIn("попыток: 3; ответов: 2", result.global_course_summary)
        self.assertIn("50%", result.global_course_summary)
        self.assertEqual([0, 100], [row.ai_score_percent for row in result.student_detailed_analyses])
        self.assertEqual(source["data_notes"], result.data_notes)
        self.assertEqual(source["input_warnings"], result.limitations)
        self.assertEqual("degraded", result.quality_status)

    def test_reference_variants_are_never_merged(self):
        source = source_data(2)
        first, second = source["tests"][0]["student_attempts"]
        second["answers"] = copy.deepcopy(first["answers"])
        first["answers"][0]["reference_answer"] = "Первый эталон"
        second["answers"][0]["reference_answer"] = "Второй эталон"
        cases, _, _ = FullAnalysisPipeline.source_cases(source)
        self.assertEqual({"Первый эталон", "Второй эталон"}, {case["reference"] for case in cases})

    def test_rounding_cannot_promote_a_question_across_a_threshold(self):
        for wrong, expected_count, priority in [(999, 0, "Low"), (1499, 1, "Medium"), (1500, 1, "High")]:
            source = source_data(2500)
            for index, attempt in enumerate(source["tests"][0]["student_attempts"]):
                attempt["answers"][0]["is_correct_by_lms"] = index >= wrong
            result = enrich(source)
            self.assertEqual(expected_count, len(result.test_summaries[0].critical_mass_errors))
            self.assertEqual(priority, result.course_recommendations[0].priority)


class CheckpointRecoveryTests(unittest.TestCase):
    def run_full(self, source, factory):
        return json.loads(AgentManager(factory).start_local_llm_processing(compact(source)))

    def test_transport_retry_reuses_completed_answer_parts_and_all_completed_phases(self):
        source = source_data(9)
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "AI_CHECKPOINT_DIR": directory, "AI_MAX_INPUT_CHARS": "4000",
        }):
            factory, main, _, _ = responding_factory()
            normal = main.execute.side_effect
            def fail_second(prompt, text, **kwargs):
                if json.loads(text)["answers"][0]["id"] == "a5":
                    raise AgentTransportError("temporary outage")
                return normal(prompt, text, **kwargs)
            main.execute.side_effect = fail_second
            with self.assertRaisesRegex(Exception, "temporary outage"):
                self.run_full(source, factory)
            retry_factory, retry_main, _, _ = responding_factory()
            result = self.run_full(source, retry_factory)
            sent_ids = [item["id"] for call in retry_main.execute.call_args_list for item in json.loads(call.args[1])["answers"]]
            self.assertEqual(["a5", "a6", "a7", "a8", "a9"], sent_ids)
            self.assertEqual(9, len(result["student_detailed_analyses"]))
            replay_factory, *agents = responding_factory()
            self.assertEqual(result, self.run_full(source, replay_factory))
            for agent in agents:
                agent.execute.assert_not_called()

            changed = copy.deepcopy(source)
            changed["tests"][0]["student_attempts"][0]["answers"][0]["user_answer"] = "Изменённый ответ"
            new_factory, new_main, _, _ = responding_factory()
            self.run_full(changed, new_factory)
            self.assertTrue(new_main.execute.called)

    def test_invalid_output_is_not_cached_as_a_successful_part(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AI_CHECKPOINT_DIR": directory}):
            source = source_data(1)
            factory, main, _, _ = responding_factory()
            main.execute.side_effect = None
            main.execute.return_value = "{}"
            self.assertEqual("degraded", self.run_full(source, factory)["quality_status"])
            retry_factory, retry_main, _, _ = responding_factory()
            self.assertEqual("verified", self.run_full(source, retry_factory)["quality_status"])
            self.assertEqual(1, retry_main.execute.call_count)

    def test_summary_failure_does_not_repeat_answer_inference(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AI_CHECKPOINT_DIR": directory}):
            source = source_data(5)
            factory, _, _, summary = responding_factory()
            summary.execute.side_effect = AgentTransportError("summary unavailable")
            with self.assertRaisesRegex(Exception, "summary unavailable"):
                self.run_full(source, factory)
            factory, main, anomaly, summary = responding_factory()
            result = self.run_full(source, factory)
            main.execute.assert_not_called()
            anomaly.execute.assert_not_called()
            self.assertTrue(summary.execute.called)
            self.assertEqual("verified", result["quality_status"])
