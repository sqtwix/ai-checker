from pydantic import BaseModel, Field
from typing import List

# ========================= Analysis Response Schemas =========================

# Эти схемы соответствуют контракту ответа от ai-driver к api-core.
# Содержат результаты работы всей цепочки агентов: анализ, аномалии, статистику.

class CriticalMassError(BaseModel):
    # ID вопроса с массовой ошибкой
    question_id: str
    # Процент неправильных ответов
    fail_rate_percent: float
    # Описание паттерна ошибок
    error_pattern_description: str
    # Методическая причина
    methodological_reason: str

class TestSummary(BaseModel):
    # Название теста
    test_name: str
    # Массовые ошибки по вопросам
    critical_mass_errors: List[CriticalMassError] = []

class StudentDetailedAnalysis(BaseModel):
    # ID студента
    student_id: str
    # Название теста
    test_name: str
    # ID вопроса
    question_id: str
    # Оценка совпадения с эталоном (0-100)
    ai_score_percent: float
    # Статус уникальности: "Normal", "SuspiciousMatch"
    uniqueness_status: str
    # Объяснение ошибки
    error_explanation: str

class Anomaly(BaseModel):
    # ID студента с аномалией
    student_id: str
    # Тип: "SpeedCheating", "SuspiciousMatch"
    anomaly_type: str
    # Серьезность: "Low", "Medium", "High"
    severity: str
    # Описание аномалии
    description: str

class CourseRecommendation(BaseModel):
    # Цель рекомендации (тест, тема)
    target: str
    # Действие
    action_item: str
    # Приоритет: "Low", "Medium", "High"
    priority: str

class AnalysisResponse(BaseModel):
    # Идентификатор пакета
    batch_id: str
    # Общий вывод по курсу
    global_course_summary: str
    # Сводки по тестам
    test_summaries: List[TestSummary] = []
    # Детальный анализ по студентам
    student_detailed_analyses: List[StudentDetailedAnalysis] = []
    # Аномалии
    anomalies: List[Anomaly] = []
    # Рекомендации
    course_recommendations: List[CourseRecommendation] = []