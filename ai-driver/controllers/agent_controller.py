from backend.agent_manager import AgentManager
from schemas.analysis_response import AnalysisResponse, StudentDetailedAnalysis
from schemas.analysis_request import AnalysisRequest
from fastapi import HTTPException
from fastapi.responses import JSONResponse
import json
import logging

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
        except Exception as e:
            logger.warning("DeepSeek processing failed or timed out: %s. Falling back to programmatic analysis.", str(e))
            fallback_data = self._generate_programmatic_analysis(input_data)
            return JSONResponse(
                status_code=200,
                content=fallback_data
            )

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
        except Exception as e:
            logger.warning("SberGPT processing failed or timed out: %s. Falling back to programmatic analysis.", str(e))
            fallback_data = self._generate_programmatic_analysis(input_data)
            return JSONResponse(
                status_code=200,
                content=fallback_data
            )

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
        except Exception as e:
            logger.warning("Qwen Local processing failed or timed out: %s. Falling back to programmatic analysis.", str(e))
            fallback_data = self._generate_programmatic_analysis(input_data)
            return JSONResponse(
                status_code=200,
                content=fallback_data
            )

    def _enrich_and_complete_response(self, response: AnalysisResponse, input_data: AnalysisRequest) -> AnalysisResponse:
        """
        Гарантирует, что каждый ответ каждого студента присутствует в student_detailed_analyses.
        Если ИИ-агент пропустил какой-то ответ (например, потому что он верный),
        мы программно добавляем его с дефолтными значениями, чтобы статистика в таблицах была точной.
        """
        existing = {
            (detail.student_id, detail.test_name, detail.question_id)
            for detail in response.student_detailed_analyses
        }

        for test in input_data.tests:
            for attempt in test.student_attempts:
                for answer in attempt.answers:
                    key = (attempt.student_id, test.test_name, answer.question_id)
                    if key not in existing:
                        is_correct = answer.is_correct_by_lms
                        ai_score = 100.0 if is_correct else 0.0
                        
                        # Сопоставление с эталоном
                        ref_ans = ""
                        for q in test.questions:
                            if q.question_id == answer.question_id:
                                ref_ans = q.reference_answer
                                break
                        
                        clean_ref = str(ref_ans).strip().lower()
                        clean_user = str(answer.user_answer).strip().lower()
                        if clean_user == clean_ref:
                            ai_score = 100.0
                        elif clean_ref and clean_user and (clean_ref in clean_user or clean_user in clean_ref):
                            ai_score = max(ai_score, 50.0)

                        explanation = "Ответ верный. Ошибок не обнаружено." if ai_score >= 100.0 else "Ответ отличается от эталона. Зафиксирована ошибка."
                        
                        response.student_detailed_analyses.append(
                            StudentDetailedAnalysis(
                                student_id=attempt.student_id,
                                test_name=test.test_name,
                                question_id=answer.question_id,
                                ai_score_percent=ai_score,
                                uniqueness_status="Normal",
                                error_explanation=explanation
                            )
                        )
                        existing.add(key)
        return response

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
                    if answer.time_spent_seconds < 0:
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
                if attempt.answers:
                    total_time = sum(ans.time_spent_seconds for ans in attempt.answers)
                    avg_time = total_time / len(attempt.answers)
                else:
                    total_time = 0
                    avg_time = 0
                    
                if avg_time < 10 and score_percent >= 80:
                    anomalies.append({
                        "student_id": attempt.student_id,
                        "anomaly_type": "SpeedCheating",
                        "severity": "High",
                        "description": f"Аномально быстрое прохождение теста '{test.test_name}': в среднем {avg_time:.1f} сек на вопрос при результате {score_percent}%."
                    })
                elif avg_time > 300 and score_percent < 50:
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