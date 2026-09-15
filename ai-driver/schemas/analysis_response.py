from pydantic import BaseModel, Field
from typing import List, Literal

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
    critical_mass_errors: List[CriticalMassError] = Field(default_factory=list)

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
    test_summaries: List[TestSummary] = Field(default_factory=list)
    # Детальный анализ по студентам
    student_detailed_analyses: List[StudentDetailedAnalysis] = Field(default_factory=list)
    # Аномалии
    anomalies: List[Anomaly] = Field(default_factory=list)
    # Рекомендации
    course_recommendations: List[CourseRecommendation] = Field(default_factory=list)
    generation_mode: Literal["llm", "fallback"] = "llm"
    quality_status: Literal["verified", "degraded", "failed"] = "verified"
    limitations: List[str] = Field(default_factory=list)
