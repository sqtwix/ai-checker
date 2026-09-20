import os
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.agent_factory import AgentFactory
from backend.agent_client import AgentClient, AgentSemanticError
from backend.agent_manager import AgentManager
from controllers.agent_controller import AgentController
from schemas.analysis_request import AnalysisRequest
from schemas.analysis_response import AnalysisResponse


def valid_request(time_spent_seconds=None):
    return AnalysisRequest.model_validate({
        "batch_id": "test-batch",
        "course_name": "Test course",
        "tests": [{
            "test_name": "Test 1",
            "questions": [{
                "question_id": "q1",
                "question_text": "Question",
                "question_type": "single",
                "reference_answer": "A",
            }],
            "student_attempts": [{
                "student_id": "student-1",
                "completion_date": "2026-01-01",
                "status": "completed",
                "total_score_text": "1 / 1 (100%)",
                "answers": [{
                    "question_id": "q1",
                    "user_answer": "A",
                    "is_correct_by_lms": True,
                    "time_spent_seconds": time_spent_seconds,
                }],
            }],
        }],
    })


class AgentControllerTests(unittest.TestCase):
    def test_markdown_fenced_json_is_normalized(self):
        content = '```json\n{"status":"ok"}\n```'
        self.assertEqual('{"status":"ok"}', AgentClient._normalize_json_object(content))

    def test_unclosed_fence_is_not_silently_repaired(self):
        content = '```json\n{"status":"ok"}'
        self.assertEqual(content, AgentClient._normalize_json_object(content))

    def test_invalid_request_stays_http_400(self):
        controller = AgentController(Mock())
        with self.assertRaises(HTTPException) as context:
            controller.get_deepseek_data_analysis(AnalysisRequest(
                batch_id="empty", course_name="Empty", tests=[]
            ))
        self.assertEqual(400, context.exception.status_code)

    def test_provider_failure_is_visible_by_default(self):
        manager = Mock()
        manager.start_deepseek_processing.side_effect = RuntimeError("provider down")
        controller = AgentController(manager)
        with patch.dict(os.environ, {"ALLOW_PROGRAMMATIC_FALLBACK": "false"}):
            with self.assertRaises(HTTPException) as context:
                controller.get_deepseek_data_analysis(valid_request())
        self.assertEqual(502, context.exception.status_code)

    def test_opt_in_fallback_is_labeled_and_does_not_invent_timing_anomaly(self):
        manager = Mock()
        manager.start_deepseek_processing.side_effect = RuntimeError("provider down")
        controller = AgentController(manager)
        with patch.dict(os.environ, {"ALLOW_PROGRAMMATIC_FALLBACK": "true"}):
            response = controller.get_deepseek_data_analysis(valid_request())
        payload = response.body.decode("utf-8")
        self.assertIn("РЕЗЕРВНЫЙ РАСЧЕТ БЕЗ ИИ", payload)
        self.assertNotIn("SpeedCheating", payload)

    def test_cloud_provider_requires_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(Exception, "API key is not configured"):
                AgentFactory().create_queue("deepseek")

    def test_ai_timing_anomaly_is_removed_when_source_has_no_timing(self):
        controller = AgentController(Mock())
        response = AnalysisResponse.model_validate({
            "batch_id": "test-batch",
            "global_course_summary": "summary",
            "anomalies": [{
                "student_id": "student-1",
                "anomaly_type": "SpeedCheating",
                "severity": "High",
                "description": "invented timing",
            }],
        })
        enriched = controller._enrich_and_complete_response(response, valid_request())
        self.assertEqual([], enriched.anomalies)

    def test_ai_timing_anomaly_is_removed_when_timing_does_not_cross_threshold(self):
        controller = AgentController(Mock())
        response = AnalysisResponse.model_validate({
            "batch_id": "test-batch",
            "global_course_summary": "summary",
            "anomalies": [{
                "student_id": "student-1",
                "anomaly_type": "SpeedCheating",
                "severity": "High",
                "description": "Выдуманная аномалия скорости",
            }],
        })
        enriched = controller._enrich_and_complete_response(response, valid_request(time_spent_seconds=60))
        self.assertEqual([], enriched.anomalies)

    def test_model_cannot_invent_suspicious_uniqueness_status(self):
        response = AnalysisResponse.model_validate({
            "batch_id": "test-batch",
            "global_course_summary": "summary",
            "student_detailed_analyses": [{
                "student_id": "student-1",
                "test_name": "Test 1",
                "question_id": "q1",
                "ai_score_percent": 100,
                "uniqueness_status": "SuspiciousMatch",
                "error_explanation": "Ответ верный.",
            }],
        })
        enriched = AgentController(Mock())._enrich_and_complete_response(response, valid_request())
        self.assertEqual("Normal", enriched.student_detailed_analyses[0].uniqueness_status)

    def test_source_data_overrides_hallucinated_metrics_and_english_text(self):
        request = valid_request()
        request.tests[0].student_attempts[0].answers[0].is_correct_by_lms = False
        response = AnalysisResponse.model_validate({
            "batch_id": "invented",
            "global_course_summary": "100% correct",
            "test_summaries": [],
            "student_detailed_analyses": [{
                "student_id": "student-1",
                "test_name": "Test 1",
                "question_id": "q1",
                "ai_score_percent": 17,
                "uniqueness_status": "Normal",
                "error_explanation": "Wrong answer",
            }],
            "anomalies": [{
                "student_id": "student-1",
                "anomaly_type": "SuspiciousMatch",
                "severity": "High",
                "description": "Unsupported claim",
            }],
            "course_recommendations": [{
                "target": "Студенты",
                "action_item": "Проверьте SpeedCheating, даже если подтверждений нет",
                "priority": "High",
            }],
        })
        enriched = AgentController(Mock())._enrich_and_complete_response(response, request)
        self.assertEqual("test-batch", enriched.batch_id)
        self.assertIn("0%", enriched.global_course_summary)
        self.assertEqual(100.0, enriched.test_summaries[0].critical_mass_errors[0].fail_rate_percent)
        self.assertEqual([], enriched.anomalies)
        self.assertIn("Ответ отличается", enriched.student_detailed_analyses[0].error_explanation)
        self.assertIn("Разберите", enriched.course_recommendations[0].action_item)
        self.assertNotIn("SpeedCheating", enriched.course_recommendations[0].action_item)

    def test_incorrect_answer_never_receives_model_invented_partial_credit(self):
        request = valid_request()
        request.tests[0].student_attempts[0].answers[0].is_correct_by_lms = False
        response = AnalysisResponse.model_validate({
            "batch_id": "invented",
            "global_course_summary": "Итог",
            "student_detailed_analyses": [{
                "student_id": "student-1",
                "test_name": "Test 1",
                "question_id": "q1",
                "ai_score_percent": 83,
                "uniqueness_status": "Normal",
                "error_explanation": "Ответ не совпадает с эталоном.",
            }],
        })
        enriched = AgentController(Mock())._enrich_and_complete_response(response, request)
        self.assertEqual(0.0, enriched.student_detailed_analyses[0].ai_score_percent)

    def test_large_model_input_is_bounded_and_samples_each_test(self):
        source = {
            "batch_id": "large",
            "course_name": "Курс",
            "tests": [],
        }
        for test_index in range(3):
            questions = []
            attempts = []
            for question_index in range(30):
                question_id = f"q-{test_index}-{question_index}"
                questions.append({
                    "question_id": question_id,
                    "question_text": "Очень длинный вопрос " * 80,
                    "question_type": "единственный выбор",
                    "reference_answer": "Эталон " * 80,
                })
                attempts.append({
                    "student_id": f"student-{test_index}-{question_index}",
                    "completion_date": "2026-01-01",
                    "status": "completed",
                    "total_score_text": "0%",
                    "answers": [{
                        "question_id": question_id,
                        "user_answer": "Неверный ответ " * 80,
                        "is_correct_by_lms": False,
                        "time_spent_seconds": None,
                    }],
                })
            source["tests"].append({
                "test_name": f"Тест {test_index}",
                "questions": questions,
                "student_attempts": attempts,
            })

        with patch.dict(os.environ, {"AI_MAX_INPUT_CHARS": "5000"}):
            bounded = AgentManager._build_bounded_model_input(source)
        self.assertLessEqual(len(__import__("json").dumps(bounded, ensure_ascii=False)), 5000)
        self.assertEqual({"Тест 0", "Тест 1", "Тест 2"}, {test["test_name"] for test in bounded["tests"]})
        self.assertTrue(all(
            not answer["is_correct_by_lms"]
            for test in bounded["tests"]
            for attempt in test["student_attempts"]
            for answer in attempt["answers"]
        ))

    def test_bounded_pipeline_does_not_retry_semantic_failure_or_call_later_agents(self):
        main_agent = Mock()
        main_agent.execute.side_effect = AgentSemanticError("invalid JSON")
        anomaly_agent = Mock()
        summary_agent = Mock()
        factory = Mock()
        factory.create_queue.return_value = [main_agent, anomaly_agent, summary_agent]
        manager = AgentManager(factory)
        source = {
            "batch_id": "bounded",
            "course_name": "Курс",
            "tests": [],
            "padding": "x" * 10000,
        }

        result = __import__("json").loads(manager.start_local_llm_processing(__import__("json").dumps(source)))

        self.assertEqual("degraded", result["quality_status"])
        self.assertTrue(result["limitations"])
        anomaly_agent.execute.assert_not_called()
        summary_agent.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
