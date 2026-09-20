from backend.agent_manager import AgentManager
from schemas.analysis_response import (
    AnalysisResponse,
    Anomaly,
    CourseRecommendation,
    CriticalMassError,
    StudentDetailedAnalysis,
    TestSummary,
)
from schemas.analysis_request import AnalysisRequest
from fastapi import HTTPException
from fastapi.responses import JSONResponse
import json
import logging
import os

logger = logging.getLogger(__name__)

class AgentController:
    def __init__(self, agent_manager: AgentManager):
        self.agent_manager = agent_manager

    def get_deepseek_data_analysis(self, input_data: AnalysisRequest):
        try:
            self._validate_request(input_data)
            logger.info("Executing DeepSeek agent pipeline processing...")
            ai_responses = self.agent_manager.start_deepseek_processing(
                input_data=input_data.model_dump_json()
            )
            # Валидация ответа нейросети через Pydantic
            validated_response = AnalysisResponse.model_validate_json(ai_responses)
            validated_response = self._enrich_and_complete_response(validated_response, input_data)
            return JSONResponse(
                status_code=200,
                content=validated_response.model_dump()
            )
        except HTTPException:
            raise
        except Exception as e:
            return self._handle_provider_failure("DeepSeek", input_data, e)

    def get_sbergpt_data_analysis(self, input_data: AnalysisRequest):
        try:
            self._validate_request(input_data)
            logger.info("Executing SberGPT agent pipeline processing...")
            ai_responses = self.agent_manager.start_sbergpt_processing(
                input_data=input_data.model_dump_json()
            )
            # Валидация ответа нейросети через Pydantic
            validated_response = AnalysisResponse.model_validate_json(ai_responses)
            validated_response = self._enrich_and_complete_response(validated_response, input_data)
            return JSONResponse(
                status_code=200,
                content=validated_response.model_dump()
            )
        except HTTPException:
            raise
        except Exception as e:
            return self._handle_provider_failure("SberGPT", input_data, e)

    def get_qwen_local_data_analysis(self, input_data: AnalysisRequest):
        try:
            self._validate_request(input_data)
            logger.info("Executing Qwen Local agent pipeline processing...")
            ai_responses = self.agent_manager.start_qwen_local_processing(
                input_data=input_data.model_dump_json()
            )
            # Валидация ответа нейросети через Pydantic
            validated_response = AnalysisResponse.model_validate_json(ai_responses)
            validated_response = self._enrich_and_complete_response(validated_response, input_data)
            return JSONResponse(
                status_code=200,
                content=validated_response.model_dump()
            )
        except HTTPException:
            raise
        except Exception as e:
            return self._handle_provider_failure("Qwen Local", input_data, e)

    def get_local_llm_data_analysis(self, input_data: AnalysisRequest):
        try:
            self._validate_request(input_data)
            ai_responses = self.agent_manager.start_local_llm_processing(
                input_data=input_data.model_dump_json()
            )
            validated_response = AnalysisResponse.model_validate_json(ai_responses)
            validated_response = self._enrich_and_complete_response(validated_response, input_data)
            return JSONResponse(status_code=200, content=validated_response.model_dump())
        except HTTPException:
            raise
        except Exception as e:
            return self._handle_provider_failure("Local LLM", input_data, e)

    def _handle_provider_failure(self, provider: str, input_data: AnalysisRequest, error: Exception):
        logger.exception("%s processing failed", provider)
        allow_fallback = os.getenv("ALLOW_PROGRAMMATIC_FALLBACK", "false").lower() == "true"
        if not allow_fallback:
            raise HTTPException(
                status_code=502,
                detail=f"Провайдер {provider} недоступен или настроен неверно"
            ) from error

        logger.warning("ALLOW_PROGRAMMATIC_FALLBACK=true: returning a non-AI report")
        fallback_data = self._generate_programmatic_analysis(input_data)
        fallback_data["global_course_summary"] = (
            "РЕЗЕРВНЫЙ РАСЧЕТ БЕЗ ИИ. " + fallback_data["global_course_summary"]
        )
        fallback_data["generation_mode"] = "fallback"
        fallback_data["quality_status"] = "degraded"
        fallback_data["limitations"] = ["ИИ-провайдер был недоступен; сформирован только детерминированный резервный отчёт."]
        return JSONResponse(status_code=200, content=fallback_data)

    def _enrich_and_complete_response(self, response: AnalysisResponse, input_data: AnalysisRequest) -> AnalysisResponse:
        """Merge qualitative AI text with authoritative source-derived metrics."""
        response.batch_id = input_data.batch_id
        valid_answers = {}
        ordered_keys = []
        total_attempts = 0
        total_answers = 0
        correct_answers = 0
        for test in input_data.tests:
            total_attempts += len(test.student_attempts)
            for attempt in test.student_attempts:
                for answer in attempt.answers:
                    key = (attempt.student_id, test.test_name, answer.question_id)
                    valid_answers[key] = answer
                    ordered_keys.append(key)
                    total_answers += 1
                    correct_answers += int(answer.is_correct_by_lms)

        suspicious_answer_keys = set()
        timing_evidence = set()
        ignored_duplicate_values = {"", "неверный ответ", "неправильный ответ", "ошибка", "incorrect"}
        for test in input_data.tests:
            for attempt in test.student_attempts:
                timed_answers = [
                    answer for answer in attempt.answers
                    if answer.time_spent_seconds is not None
                ]
                if timed_answers:
                    average_time = sum(answer.time_spent_seconds for answer in timed_answers) / len(timed_answers)
                    success_rate = sum(answer.is_correct_by_lms for answer in attempt.answers) * 100.0 / len(attempt.answers)
                    if average_time < 10 and success_rate >= 80:
                        timing_evidence.add((attempt.student_id, "SpeedCheating"))
                    if average_time > 300 and success_rate < 50:
                        timing_evidence.add((attempt.student_id, "ExtremeStruggling"))

            for question in test.questions:
                by_value = {}
                for attempt in test.student_attempts:
                    answer = next((item for item in attempt.answers if item.question_id == question.question_id), None)
                    if answer and not answer.is_correct_by_lms:
                        normalized = answer.user_answer.strip().casefold()
                        if normalized not in ignored_duplicate_values:
                            by_value.setdefault(normalized, []).append(attempt.student_id)
                for student_ids in by_value.values():
                    if len(student_ids) >= 2:
                        suspicious_answer_keys.update(
                            (student_id, test.test_name, question.question_id)
                            for student_id in student_ids
                        )

        ai_details = {}
        for detail in response.student_detailed_analyses:
            key = (detail.student_id, detail.test_name, detail.question_id)
            if key in valid_answers and key not in ai_details:
                ai_details[key] = detail

        completed_details = []
        for student_id, test_name, question_id in ordered_keys:
            key = (student_id, test_name, question_id)
            answer = valid_answers[key]
            detail = ai_details.get(key)
            if answer.is_correct_by_lms:
                score = 100.0
                explanation = "Ответ верный. Ошибок не обнаружено."
            else:
                # LMS is the authoritative correctness source. A language model
                # must not invent a quantitative partial-credit score.
                score = 0.0
                explanation = detail.error_explanation.strip() if detail else ""
                if not self._contains_cyrillic(explanation):
                    explanation = "Ответ отличается от эталона. Проверьте понимание темы и формат ответа."
            completed_details.append(StudentDetailedAnalysis(
                student_id=student_id,
                test_name=test_name,
                question_id=question_id,
                ai_score_percent=score,
                uniqueness_status="SuspiciousMatch" if key in suspicious_answer_keys else "Normal",
                error_explanation=explanation,
            ))
        response.student_detailed_analyses = completed_details

        response.test_summaries = []
        critical_error_count = 0
        for test in input_data.tests:
            critical_errors = []
            for question in test.questions:
                matching = [
                    answer
                    for attempt in test.student_attempts
                    for answer in attempt.answers
                    if answer.question_id == question.question_id
                ]
                if not matching:
                    continue
                failed = sum(not answer.is_correct_by_lms for answer in matching)
                fail_rate = round(failed * 100.0 / len(matching), 1)
                if fail_rate >= 40.0:
                    critical_errors.append(CriticalMassError(
                        question_id=question.question_id,
                        fail_rate_percent=fail_rate,
                        error_pattern_description=f"Ошиблись {failed} из {len(matching)} студентов ({fail_rate:g}%).",
                        methodological_reason="Проверьте формулировку вопроса и добавьте разбор типичной ошибки.",
                    ))
            critical_error_count += len(critical_errors)
            response.test_summaries.append(TestSummary(
                test_name=test.test_name,
                critical_mass_errors=critical_errors,
            ))

        suspicious_students = {key[0] for key in suspicious_answer_keys}

        allowed_types = {"SpeedCheating", "ExtremeStruggling", "SuspiciousMatch"}
        allowed_severities = {"Low", "Medium", "High"}
        filtered_anomalies = []
        seen_anomalies = set()
        valid_students = {key[0] for key in valid_answers}
        for anomaly in response.anomalies:
            if anomaly.student_id not in valid_students or anomaly.anomaly_type not in allowed_types:
                continue
            if anomaly.anomaly_type in {"SpeedCheating", "ExtremeStruggling"} and (
                anomaly.student_id, anomaly.anomaly_type
            ) not in timing_evidence:
                continue
            if anomaly.anomaly_type == "SuspiciousMatch" and anomaly.student_id not in suspicious_students:
                continue
            marker = (anomaly.student_id, anomaly.anomaly_type)
            if marker in seen_anomalies:
                continue
            description = anomaly.description.strip()
            if not self._contains_cyrillic(description):
                description = "Обнаружен подтверждённый входными данными необычный повтор ответа."
            filtered_anomalies.append(Anomaly(
                student_id=anomaly.student_id,
                anomaly_type=anomaly.anomaly_type,
                severity=anomaly.severity if anomaly.severity in allowed_severities else "Medium",
                description=description,
            ))
            seen_anomalies.add(marker)
        response.anomalies = filtered_anomalies

        success_rate = round(correct_answers * 100.0 / total_answers, 1) if total_answers else 0.0
        response.global_course_summary = (
            f"Проанализировано попыток: {total_attempts}; ответов: {total_answers}. "
            f"Правильных ответов: {correct_answers} ({success_rate:g}%). "
            f"Вопросов с массовой ошибкой: {critical_error_count}. "
            f"Подтверждённых аномалий: {len(response.anomalies)}."
        )

        # Recommendations are operational decisions, so derive them only from
        # evidence that survived the checks above. Free-form model suggestions
        # may otherwise mention unsupported anomalies or invented questions.
        evidence_recommendations = []
        if response.anomalies:
            evidence_recommendations.append(CourseRecommendation(
                target="Преподаватели",
                action_item=(
                    f"Проверьте {len(response.anomalies)} подтверждённых аномалий по исходным данным "
                    "перед принятием организационных решений."
                ),
                priority="High",
            ))
        for summary in response.test_summaries:
            for error in summary.critical_mass_errors:
                evidence_recommendations.append(CourseRecommendation(
                    target=f"{summary.test_name}: вопрос {error.question_id}",
                    action_item=(
                        "Разберите типичную ошибку со студентами и повторно проверьте понимание темы."
                    ),
                    priority="High" if error.fail_rate_percent >= 60.0 else "Medium",
                ))
        if not evidence_recommendations:
            evidence_recommendations.append(CourseRecommendation(
                target="Курс",
                action_item="Продолжайте наблюдать динамику результатов в следующих тестах.",
                priority="Low",
            ))
        response.course_recommendations = evidence_recommendations[:3]
        return response

    @staticmethod
    def _contains_cyrillic(value: str) -> bool:
        return any("а" <= character.casefold() <= "я" or character.casefold() == "ё" for character in value)

    def _validate_request(self, input_data: AnalysisRequest):
        # Валидирует входные данные на соответствие бизнес-правилам.
        # Проверяет наличие тестов, попыток студентов, эталонных ответов.
        # При обнаружении проблем выбрасывает HTTPException с кодом 400.

        errors: list = []

        if not input_data.tests:
            errors.append("В запросе отсутствуют тесты для анализа")

        for test_idx, test in enumerate(input_data.tests):
            # Проверка наличия попыток студентов
            if not test.student_attempts:
                errors.append(
                    "В тесте '" + test.test_name + "' отсутствуют попытки студентов"
                )

            # Проверка наличия эталонных ответов в вопросах
            for question in test.questions:
                if not question.reference_answer:
                    errors.append(
                        "В вопросе '" + question.question_id + "' теста '" +
                        test.test_name + "' отсутствует эталонный ответ"
                    )

            # Проверка времени выполнения (не может быть отрицательным)
            for attempt in test.student_attempts:
                for answer in attempt.answers:
                    if answer.time_spent_seconds is not None and answer.time_spent_seconds < 0:
                        errors.append(
                            "У студента " + attempt.student_id +
                            " в вопросе " + answer.question_id +
                            " указано отрицательное время выполнения"
                        )

        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))

        return input_data

    def _generate_programmatic_analysis(self, input_data: AnalysisRequest) -> dict:
        """
        Программный анализатор в качестве фоллбека. Расчитывает реальные показатели
        успеваемости и поведенческие аномалии студентов на основе переданного JSON.
        """
        test_summaries = []
        student_detailed_analyses = []
        anomalies = []
        course_recommendations = []
        
        total_attempts = 0
        successful_attempts = 0
        
        for test in input_data.tests:
            question_stats = {} # question_id -> {total, failed, ref, text}
            for q in test.questions:
                question_stats[q.question_id] = {
                    "total": 0, 
                    "failed": 0, 
                    "ref": q.reference_answer, 
                    "text": q.question_text
                }
                
            for attempt in test.student_attempts:
                total_attempts += 1
                
                # Извлечение успешности попытки
                score_percent = 70.0
                try:
                    if "%" in attempt.total_score_text:
                        parts = attempt.total_score_text.split("(")
                        if len(parts) > 1:
                            score_percent = float(parts[1].replace(")", "").replace("%", "").strip())
                except Exception:
                    pass
                
                if score_percent >= 75.0:
                    successful_attempts += 1
                    
                # Анализ аномалий по времени
                timed_answers = [
                    answer.time_spent_seconds
                    for answer in attempt.answers
                    if answer.time_spent_seconds is not None
                ]
                total_time = sum(timed_answers)
                avg_time = total_time / len(timed_answers) if timed_answers else None
                    
                if avg_time is not None and avg_time < 10 and score_percent >= 80:
                    anomalies.append({
                        "student_id": attempt.student_id,
                        "anomaly_type": "SpeedCheating",
                        "severity": "High",
                        "description": f"Аномально быстрое прохождение теста '{test.test_name}': в среднем {avg_time:.1f} сек на вопрос при результате {score_percent}%."
                    })
                elif avg_time is not None and avg_time > 300 and score_percent < 50:
                    anomalies.append({
                        "student_id": attempt.student_id,
                        "anomaly_type": "ExtremeStruggling",
                        "severity": "Medium",
                        "description": f"Студент испытывал серьезные трудности в тесте '{test.test_name}': потрачено {total_time/60:.1f} мин при результате {score_percent}%."
                    })
                    
                # Детальный анализ по вопросам
                for ans in attempt.answers:
                    q_stat = question_stats.get(ans.question_id)
                    if q_stat:
                        q_stat["total"] += 1
                        if not ans.is_correct_by_lms:
                            q_stat["failed"] += 1
                            
                    is_correct = ans.is_correct_by_lms
                    ai_score = 100.0 if is_correct else 0.0
                    
                    # Нечеткое сопоставление
                    ref_ans = q_stat["ref"] if q_stat else ""
                    clean_ref = str(ref_ans).strip().lower()
                    clean_user = str(ans.user_answer).strip().lower()
                    
                    if clean_user == clean_ref:
                        ai_score = 100.0
                    elif clean_ref and clean_user and (clean_ref in clean_user or clean_user in clean_ref):
                        ai_score = max(ai_score, 50.0)
                        
                    uniqueness = "Normal"
                    explanation = "Ответ полностью совпадает с эталонным решением." if ai_score == 100.0 else "Ответ отличается от эталона. Зафиксирована ошибка в логике или синтаксисе."
                    
                    student_detailed_analyses.append({
                        "student_id": attempt.student_id,
                        "test_name": test.test_name,
                        "question_id": ans.question_id,
                        "ai_score_percent": ai_score,
                        "uniqueness_status": uniqueness,
                        "error_explanation": explanation
                    })
            
            # Расчет критических ошибок по вопросам
            critical_errors = []
            for q_id, stats in question_stats.items():
                if stats["total"] > 0:
                    fail_rate = (stats["failed"] / stats["total"]) * 100
                    if fail_rate >= 40:
                        critical_errors.append({
                            "question_id": q_id,
                            "fail_rate_percent": fail_rate,
                            "error_pattern_description": f"Студенты часто допускают неточности в вопросе '{stats['text']}'. Доля ошибок: {fail_rate:.0f}%.",
                            "methodological_reason": "Типичная путаница с базовыми правилами. Требуется провести дополнительный разбор темы."
                        })
                        
            test_summaries.append({
                "test_name": test.test_name,
                "critical_mass_errors": critical_errors
            })
            
            # Рекомендации
            for ce in critical_errors:
                course_recommendations.append({
                    "target": f"{test.test_name}: Вопрос {ce['question_id']}",
                    "action_item": "Добавить краткую теоретическую подсказку или обновить формулировку задания в курсе.",
                    "priority": "High" if ce["fail_rate_percent"] >= 60 else "Medium"
                })
                
        if not course_recommendations:
            course_recommendations.append({
                "target": input_data.course_name,
                "action_item": "Рекомендуется продолжить регулярный мониторинг результатов тестирования.",
                "priority": "Low"
            })
            
        pass_rate = (successful_attempts / total_attempts * 100) if total_attempts > 0 else 100.0
        global_summary = f"Анализ успеваемости группы по курсу '{input_data.course_name}' успешно выполнен. Средний показатель правильных ответов составляет {pass_rate:.1f}%. "
        if anomalies:
            global_summary += f"Обнаружено аномалий поведения: {len(anomalies)}."
        else:
            global_summary += "Подозрительных аномалий в поведении студентов не обнаружено."
            
        return {
            "batch_id": input_data.batch_id,
            "global_course_summary": global_summary,
            "test_summaries": test_summaries,
            "student_detailed_analyses": student_detailed_analyses,
            "anomalies": anomalies,
            "course_recommendations": course_recommendations
        }
