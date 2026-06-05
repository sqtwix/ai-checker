import os
from fastapi import FastAPI, HTTPException
from openai import OpenAI
from schemas.AnalysisRequest import AnalysisRequest
from schemas.AnalysisResponse import AnalysisResponse

# Инициализируем FastAPI
app = FastAPI(title="Minimal AI-Driver")

# Инициализируем клиента для DeepSeek.
# Ключ будет подтягиваться из переменных окружения операционной системы.
api_key = os.getenv("DEEPSEEK_API_KEY")
client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")

@app.post("/api/v1/analyze-single", response_model=AnalysisResponse)
async def analyze_single_answer(payload: AnalysisRequest):
    if not api_key:
        raise HTTPException(status_code=500, detail="API key 'DEEPSEEK_API_KEY' is missing in environment variables.")

    # Системный промпт, задающий роль ИИ-агенту
    system_prompt = (
        "Ты — ИИ-агент, эксперт по анализу ответов студентов. Твоя задача — сравнить ответ "
        "пользователя с эталоном, оценить логику и проверить время выполнения на аномалии. "
        "Ты должен вернуть ответ строго в формате JSON, соответствующем схеме."
    )

    # Пользовательский промпт с данными задания
    user_prompt = f"""
    Вопрос: {payload.question_text}
    Эталонный ответ: {payload.correct_answer}
    Ответ студента: {payload.user_answer}
    Время выполнения: {payload.time_spent_seconds} секунд.

    Проанализируй и заполни структуру JSON. Если время выполнения меньше 15 секунд для сложной задачи, 
    поставь time_anomaly_detected = true.
    """

    try:
        # Запрос к API DeepSeek
        response = client.chat.completions.create(
            model="deepseek-chat",  # Используем актуальную модель DeepSeek
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            # Включаем JSON-режим, чтобы модель выдавала только валидный JSON-объект
            response_format={"type": "json_object"},
            temperature=0.3  # Низкая температура для более точных и стабильных результатов
        )

        # Получаем сырой текстовый ответ от ИИ
        raw_json_content = response.choices[0].message.content

        # FastAPI и Pydantic автоматически валидируют этот текст на соответствие схеме AnalysisResponse
        return AnalysisResponse.model_validate_json(raw_json_content)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при запросе к DeepSeek: {str(e)}")