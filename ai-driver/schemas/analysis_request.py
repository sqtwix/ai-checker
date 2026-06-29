from pydantic import BaseModel, Field
from typing import List, Optional

# ========================= Analysis Request Schemas =========================

# Эти схемы соответствуют контракту данных между api-core и ai-driver.
# Представляют полную структуру: курс -> тесты -> вопросы -> попытки студентов.

class StudentAnswer(BaseModel):
    question_id: str
    # Ответ пользователя (текстовый или кодовый)
    user_answer: str
    # Флаг правильности от LMS (эталон для сравнения с оценкой ИИ)
    is_correct_by_lms: bool
    # Время выполнения задания в секундах
    time_spent_seconds: int

class StudentAttempt(BaseModel):
    # Обезличенный идентификатор студента
    student_id: str
    # Дата завершения попытки
    completion_date: str
    # Статус: "Пройден", "Не пройден", "В процессе"
    status: str
    # Текстовый результат, например "12 / 15 (80%)"
    total_score_text: str
    # Массив ответов студента на вопросы
    answers: List[StudentAnswer]

class Question(BaseModel):
    question_id: str
    # Текст вопроса
    question_text: str
    # Тип: "единственный выбор", "множественный выбор", "текстовый ввод"
    question_type: str
    # Эталонный правильный ответ
    reference_answer: str

class Test(BaseModel):
    # Название теста
    test_name: str
    # Вопросы с эталонными ответами
    questions: List[Question]
    # Попытки студентов
    student_attempts: List[StudentAttempt]

class AnalysisRequest(BaseModel):
    # Идентификатор пакета для трассировки
    batch_id: str
    # Название курса
    course_name: str
    # Массив тестов для анализа
    tests: List[Test]
