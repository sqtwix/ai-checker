import json
import copy
import os
import unittest
from unittest.mock import Mock, patch

from backend.agent_manager import AgentManager
from backend.agent_client import AgentTransportError
from backend.full_analysis import FullAnalysisPipeline, compact


def source_data(count=18):
    return {
        "batch_id": "full", "course_name": "Курс",
        "tests": [{
            "test_name": "Тест", "questions": [{
                "question_id": "q1", "question_text": "Выберите правильный вариант.",
                "reference_answer": "Эталон", "question_type": "single",
            }],
            "student_attempts": [{
                "student_id": f"student-{index}", "completion_date": "2026-09-23",
                "status": "completed", "total_score_text": "0%",
                "answers": [{
                    "question_id": "q1", "user_answer": f"Ответ {index}",
                    "is_correct_by_lms": False, "time_spent_seconds": None,
                }],
            } for index in range(count)],
        }],
    }


def responding_factory():
    main = Mock()
    anomaly = Mock()
    summary = Mock()
    main.execute.side_effect = lambda prompt, text, **kwargs: compact({
        item["id"]: "Ответ не совпадает с эталонным вариантом."
        for item in json.loads(text)["answers"]
    })
    anomaly.execute.side_effect = lambda prompt, text, **kwargs: compact({
        item["id"]: "Обнаружено подтверждённое совпадение ответов; требуется проверка."
        for item in json.loads(text)["events"]
    })
    summary.execute.return_value = compact({
        "global_course_summary": "Проверьте понимание выбранного варианта ответа.",
        "course_recommendations": [{"target": "Курс", "action_item": "Разберите ошибки.", "priority": "Medium"}],
    })
    factory = Mock()
    factory.create_queue.return_value = [main, anomaly, summary]
    return factory, main, anomaly, summary


class FullAnalysisTests(unittest.TestCase):
    def run_full(self, source, factory):
        with patch.dict(os.environ, {"AI_MAX_INPUT_CHARS": "2000"}):
            return json.loads(AgentManager(factory).start_local_llm_processing(json.dumps(source, ensure_ascii=False, indent=2)))

    def test_every_answer_is_processed_across_multiple_parts(self):
        factory, main, anomaly, summary = responding_factory()
        source = source_data()
        result = self.run_full(source, factory)
        self.assertGreater(main.execute.call_count, 1)
        self.assertEqual("verified", result["quality_status"])
        self.assertEqual([], result["limitations"])
        self.assertEqual(18, len(result["student_detailed_analyses"]))
        self.assertEqual({f"student-{i}" for i in range(18)}, {item["student_id"] for item in result["student_detailed_analyses"]})
        self.assertTrue(anomaly.execute.called)
        self.assertTrue(summary.execute.called)
        for call in main.execute.call_args_list + anomaly.execute.call_args_list + summary.execute.call_args_list:
            self.assertLessEqual(len(call.args[1]), 2000)
        reviewed = [
            item["case"] for call in summary.execute.call_args_list
            for item in json.loads(call.args[1])["reviewed_answers"]
        ]
        self.assertCountEqual([f"a{i + 1}" for i in range(18)], reviewed)

    def test_exact_duplicates_share_inference_but_all_students_receive_results(self):
        factory, main, _, _ = responding_factory()
        source = source_data(30)
        for attempt in source["tests"][0]["student_attempts"]:
            attempt["answers"][0]["user_answer"] = "Одинаковый вариант"
        result = self.run_full(source, factory)
        sent = json.loads(main.execute.call_args.args[1])["answers"]
        self.assertEqual(1, len(sent))
        self.assertEqual(30, len(result["student_detailed_analyses"]))
        self.assertEqual(30, len(result["anomalies"]))
        self.assertEqual("verified", result["quality_status"])

    def test_same_text_with_different_correctness_is_not_merged(self):
        source = source_data(2)
        attempts = source["tests"][0]["student_attempts"]
        attempts[1]["answers"][0]["user_answer"] = attempts[0]["answers"][0]["user_answer"]
        attempts[1]["answers"][0]["is_correct_by_lms"] = True
        cases, _, metrics = FullAnalysisPipeline.source_cases(source)
        self.assertEqual(2, len(cases))
        self.assertEqual(1, metrics["correct"])

    def test_identical_question_ids_in_different_tests_keep_their_own_reference(self):
        source = source_data(1)
        other = copy.deepcopy(source["tests"][0])
        other["test_name"] = "Другой тест"
        other["questions"][0]["reference_answer"] = "Другой эталон"
        source["tests"].append(other)
        factory, main, _, _ = responding_factory()
        result = self.run_full(source, factory)
        sent = json.loads(main.execute.call_args.args[1])["answers"]
        self.assertEqual({"Эталон", "Другой эталон"}, {item["reference"] for item in sent})
        self.assertEqual({"Тест", "Другой тест"}, {item["test_name"] for item in result["student_detailed_analyses"]})

    def test_transport_failure_remains_retryable_instead_of_returning_partial_success(self):
        factory, main, _, _ = responding_factory()
        main.execute.side_effect = AgentTransportError("provider unavailable")
        with self.assertRaisesRegex(Exception, "provider unavailable"):
            self.run_full(source_data(8), factory)
        self.assertEqual(1, main.execute.call_count)

    def test_failed_summary_is_reported_even_when_all_answers_were_analyzed(self):
        factory, _, _, summary = responding_factory()
        summary.execute.return_value = compact({"global_course_summary": "Сводка.", "course_recommendations": []})
        result = self.run_full(source_data(1), factory)
        self.assertEqual(1, len(result["student_detailed_analyses"]))
        self.assertEqual("degraded", result["quality_status"])
        self.assertIn("итоговую", result["limitations"][0])

    def test_missing_ids_are_retried_in_smaller_parts(self):
        factory, main, _, _ = responding_factory()
        def respond(prompt, text, **kwargs):
            items = json.loads(text)["answers"]
            return compact({item["id"]: "Пояснение ошибки." for item in items[:1]})
        main.execute.side_effect = respond
        result = self.run_full(source_data(4), factory)
        self.assertGreater(main.execute.call_count, 1)
        self.assertEqual("verified", result["quality_status"])
        self.assertEqual(4, len(result["student_detailed_analyses"]))

    def test_permanent_missing_description_remains_explicitly_degraded(self):
        factory, main, _, _ = responding_factory()
        main.execute.return_value = "{}"
        main.execute.side_effect = None
        result = self.run_full(source_data(2), factory)
        self.assertEqual("degraded", result["quality_status"])
        self.assertIn("2 из 2", result["limitations"][0])
        self.assertEqual([], result["student_detailed_analyses"])

    def test_long_individual_answer_is_rejected_instead_of_truncated(self):
        factory, main, _, _ = responding_factory()
        source = source_data(1)
        source["tests"][0]["student_attempts"][0]["answers"][0]["user_answer"] = "Текст " * 2000
        with self.assertRaisesRegex(Exception, "AI_MAX_INPUT_CHARS"):
            self.run_full(source, factory)
        main.execute.assert_not_called()

    def test_pretty_json_does_not_make_small_input_sampled(self):
        factory, _, _, _ = responding_factory()
        result = self.run_full(source_data(1), factory)
        self.assertEqual("verified", result["quality_status"])
        self.assertFalse(result["limitations"])


if __name__ == "__main__":
    unittest.main()
