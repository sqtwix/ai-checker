from backend.agent_client import AgentClient
from backend.agent_factory import AgentFactory
from backend.cancellation import job_context, AnalysisCancelled
from backend.agent_client import AgentSemanticError
from backend.full_analysis import FullAnalysisPipeline
import json
import logging
import os
from pathlib import Path

# ========================= Agent Manager =========================

# AgentManager - class, that controls Agents Queues
# that was created by AgentFactory
# It contains methods for processing with different model types

# start_processing() - main method that starts multi-agent pipeline
# with sequential agent execution according to role model:
#   1. main-analyzer - analyzes answers, finds errors
#   2. anomalies-analyzer - detects anomalies using results from step 1
#   3. statistics-summarizer - compiles final report using results from steps 1 and 2

# This sequential approach ensures that each agent builds upon
# the context and findings of the previous one, as required by TZ.

BASE_DIR = Path(__file__).resolve().parent
PATH_TO_JSON = BASE_DIR / "system_prompts.json"

# Настройка логгера
logger = logging.getLogger(__name__)

class AgentManager:
    def __init__(self, agent_factory: AgentFactory):
        try:
            self.agent_factory = agent_factory
            # Загружаем системные промпты для всех специализаций
            with open(PATH_TO_JSON, "r", encoding="utf-8") as f:
                row_context = f.read()
                self.system_prompts = json.loads(row_context)
        except Exception as e:
            raise Exception("Agent Manager Initialization Error: " + str(e))

    def start_deepseek_processing(self, input_data: str) -> str:
        # Запускает конвейер агентов DeepSeek.
        # Агенты выполняются последовательно, передавая контекст друг другу.
        return self._run_pipeline(input_data, "deepseek")

    def start_sbergpt_processing(self, input_data: str) -> str:
        # Запускает конвейер агентов SberGPT.
        # Агенты выполняются последовательно, передавая контекст друг другу.
        return self._run_pipeline(input_data, "sbergpt")

    def start_qwen_local_processing(self, input_data: str) -> str:
        # Запускает конвейер агентов на локальной модели Qwen.
        # Агенты выполняются последовательно, передавая контекст друг другу.
        return self._run_pipeline(input_data, "qwen_local")

    def start_local_llm_processing(self, input_data: str) -> str:
        return self._run_pipeline(input_data, "local_llm")

    def _run_pipeline(self, input_data: str, model_type: str) -> str:
        with job_context(json.loads(input_data).get("batch_id")):
            return self._run_active_pipeline(input_data, model_type)

    def _run_active_pipeline(self, input_data: str, model_type: str) -> str:
        # Внутренний метод, реализующий последовательный конвейер агентов.
        # Параметры:
        #   input_data - JSON-строка с данными от api-core
        #   model_type - тип модели ("deepseek", "sbergpt", "qwen_local")
        # Возвращает:
        #   str - JSON-строка с финальным отчетом

        try:
            original_data = json.loads(input_data)
            if model_type in {"local_llm", "qwen_local", "qwen", "local"}:
                return FullAnalysisPipeline(self.agent_factory).run(original_data, model_type)
            bounded_data = self._build_bounded_model_input(original_data)
            bounded_input = json.dumps(bounded_data, ensure_ascii=False, separators=(",", ":"))
            context_was_bounded = bounded_data != original_data
            if context_was_bounded:
                logger.info(
                    "[%s] Bounded model context from %s to %s characters",
                    model_type,
                    len(input_data),
                    len(bounded_input),
                )

            # Получаем очередь агентов от фабрики
            agent_queue = self.agent_factory.create_queue(model_type)

            # Распаковываем агентов по ролям
            agent_analyzer = agent_queue[0]     # main-analyzer
            agent_anomalist = agent_queue[1]    # anomalies-analyzer
            agent_statistician = agent_queue[2] # statistics-summarizer
            limitations = []

            # Шаг 1: Анализ ответов и сравнение с эталоном
            logger.info("[%s] Step 1: main-analyzer starting", model_type)
            try:
                analysis_result = json.loads(agent_analyzer.execute(
                    self.system_prompts[0]["prompt"], bounded_input
                ))
                if not isinstance(analysis_result.get("test_summaries"), list) or not isinstance(
                    analysis_result.get("student_detailed_analyses"), list
                ):
                    raise AgentSemanticError("main analyzer response shape is invalid")
            except AgentSemanticError:
                logger.warning("[%s] main-analyzer rejected; using safe empty intermediate", model_type)
                limitations.append("Качественные пояснения основной AI-роли не прошли проверку формата.")
                analysis_result = {"test_summaries": [], "student_detailed_analyses": []}

            if context_was_bounded:
                # Full anomaly evidence, metrics, summaries and recommendations are
                # rebuilt deterministically by AgentController. Sending another
                # sampled context to two more roles adds latency without evidence.
                anomaly_result = {"anomalies": []}
                final_summary = {"global_course_summary": "", "course_recommendations": []}
                limitations.append(
                    "В bounded-режиме аномалии, сводка и рекомендации сформированы только серверными проверками."
                )
                logger.info("[%s] Bounded mode: deterministic finalization after main-analyzer", model_type)
            else:
                # Шаг 2: Поиск аномалий (передаем исходные данные + результаты шага 1)
                logger.info("[%s] Step 2: anomalies-analyzer starting", model_type)
                enriched_input = json.dumps({
                    "original_data": bounded_data,
                    "main_analysis": analysis_result
                }, ensure_ascii=False)
                try:
                    anomaly_result = json.loads(agent_anomalist.execute(
                        self.system_prompts[1]["prompt"], enriched_input
                    ))
                    if not isinstance(anomaly_result.get("anomalies"), list):
                        raise AgentSemanticError("anomaly analyzer response shape is invalid")
                except AgentSemanticError:
                    logger.warning("[%s] anomalies-analyzer rejected; using no AI anomalies", model_type)
                    limitations.append("AI-анализ аномалий не прошёл проверку формата; неподтверждённые аномалии не опубликованы.")
                    anomaly_result = {"anomalies": []}

                # Шаг 3: Финальная статистика и отчет (передаем результаты шагов 1 и 2)
                logger.info("[%s] Step 3: statistics-summarizer starting", model_type)
                final_input = json.dumps({
                    "batch_id": original_data["batch_id"],
                    "main_analysis": analysis_result,
                    "anomaly_analysis": anomaly_result
                }, ensure_ascii=False)
                try:
                    final_summary = json.loads(agent_statistician.execute(
                        self.system_prompts[2]["prompt"], final_input
                    ))
                    if not isinstance(final_summary.get("global_course_summary"), str) or not isinstance(
                        final_summary.get("course_recommendations"), list
                    ):
                        raise AgentSemanticError("statistics response shape is invalid")
                except AgentSemanticError:
                    logger.warning("[%s] statistics-summarizer rejected; using safe empty intermediate", model_type)
                    limitations.append("Итоговая AI-формулировка не прошла проверку формата.")
                    final_summary = {"global_course_summary": "", "course_recommendations": []}
            final_report = {
                "batch_id": original_data["batch_id"],
                "global_course_summary": final_summary.get("global_course_summary", ""),
                "test_summaries": analysis_result.get("test_summaries", []),
                "student_detailed_analyses": analysis_result.get("student_detailed_analyses", []),
                "anomalies": anomaly_result.get("anomalies", []),
                "course_recommendations": final_summary.get("course_recommendations", []),
                "generation_mode": "llm",
                "quality_status": "degraded" if context_was_bounded or limitations else "verified",
                "limitations": ([
                    "Нейросеть анализировала ограниченную выборку; полные числовые показатели восстановлены сервером из исходных данных."
                ] if context_was_bounded else []) + limitations,
            }

            logger.info("[%s] Pipeline completed successfully", model_type)
            return json.dumps(final_report, ensure_ascii=False)

        except AnalysisCancelled:
            raise
        except json.JSONDecodeError as e:
            raise Exception("[%s] Pipeline JSON Error: invalid JSON from agent - %s" % (model_type, str(e)))
        except Exception as e:
            raise Exception("[%s] Pipeline Processing Error: %s" % (model_type, str(e)))

    @staticmethod
    def _truncate(value, limit=320):
        text = "" if value is None else str(value)
        if len(text) <= limit:
            return text
        return text[: limit - 1].rstrip() + "…"

    @classmethod
    def _build_bounded_model_input(cls, original_data: dict) -> dict:
        """Keep LLM context bounded while authoritative metrics use the full request later."""
        max_chars = max(2000, min(200000, int(os.getenv("AI_MAX_INPUT_CHARS", "4000"))))
        compact_original = json.dumps(original_data, ensure_ascii=False, separators=(",", ":"))
        if len(compact_original) <= max_chars:
            return original_data

        source_tests = original_data.get("tests") or []
        candidates_by_test = []
        for test_index, test in enumerate(source_tests):
            incorrect = []
            correct = []
            for attempt in test.get("student_attempts") or []:
                for answer in attempt.get("answers") or []:
                    item = (test_index, attempt, answer)
                    (correct if answer.get("is_correct_by_lms") else incorrect).append(item)
            candidates_by_test.append(incorrect or correct)

        selected = []
        position = 0
        max_examples = 3
        while len(selected) < max_examples:
            added = False
            for candidates in candidates_by_test:
                if position < len(candidates):
                    selected.append(candidates[position])
                    added = True
                    if len(selected) == max_examples:
                        break
            if not added:
                break
            position += 1

        def assemble(items):
            tests = []
            for test_index, source_test in enumerate(source_tests):
                chosen = [(attempt, answer) for index, attempt, answer in items if index == test_index]
                if not chosen:
                    continue
                question_ids = {answer.get("question_id") for _, answer in chosen}
                questions = []
                for question in source_test.get("questions") or []:
                    if question.get("question_id") not in question_ids:
                        continue
                    questions.append({
                        "question_id": cls._truncate(question.get("question_id"), 160),
                        "question_text": cls._truncate(question.get("question_text")),
                        "question_type": cls._truncate(question.get("question_type"), 80),
                        "reference_answer": cls._truncate(question.get("reference_answer")),
                    })

                attempts_by_key = {}
                for attempt, answer in chosen:
                    key = (
                        attempt.get("student_id"),
                        attempt.get("completion_date"),
                        attempt.get("status"),
                        attempt.get("total_score_text"),
                    )
                    target = attempts_by_key.setdefault(key, {
                        "student_id": cls._truncate(attempt.get("student_id"), 160),
                        "completion_date": cls._truncate(attempt.get("completion_date"), 80),
                        "status": cls._truncate(attempt.get("status"), 80),
                        "total_score_text": cls._truncate(attempt.get("total_score_text"), 80),
                        "answers": [],
                    })
                    target["answers"].append({
                        "question_id": cls._truncate(answer.get("question_id"), 160),
                        "user_answer": cls._truncate(answer.get("user_answer")),
                        "is_correct_by_lms": bool(answer.get("is_correct_by_lms")),
                        "time_spent_seconds": answer.get("time_spent_seconds"),
                    })
                tests.append({
                    "test_name": cls._truncate(source_test.get("test_name"), 200),
                    "questions": questions,
                    "student_attempts": list(attempts_by_key.values()),
                })
            return {
                "batch_id": cls._truncate(original_data.get("batch_id"), 160),
                "course_name": cls._truncate(original_data.get("course_name"), 240),
                "tests": tests,
                "model_context_note": (
                    "Репрезентативная ограниченная выборка. Полные метрики и итоговые записи "
                    "будут детерминированно восстановлены сервером из исходного набора."
                ),
            }

        bounded = assemble(selected)
        while len(selected) > 1 and len(json.dumps(bounded, ensure_ascii=False)) > max_chars:
            selected.pop()
            bounded = assemble(selected)
        return bounded
