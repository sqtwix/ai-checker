from fastapi import APIRouter, status

# ========================= Routes Setup =========================

# setup_routes - функция для регистрации эндпоинтов агентов.
# Добавляет маршруты для DeepSeek, GigaChat и локального provider.

def setup_routes(agent_controller):
    router = APIRouter()

    router.add_api_route(
        path="/get_deepseek_data_analysis",
        endpoint=agent_controller.get_deepseek_data_analysis,
        methods=["POST"],
        summary="Выполнить обрабокту данных используя группу агентов DeepSeek",
        description="Возвращает ai-response, который содержит результаты обработки данных группой агентов DeepSeek"
    )

    router.add_api_route(
        path="/get_sbergpt_data_analysis",
        endpoint=agent_controller.get_sbergpt_data_analysis,
        methods=["POST"],
        summary="Выполнить обрабокту данных используя группу агентов SberGPT",
        description="Возвращает ai-response, который содержит результаты обработки данных группой агентов SberGPT"
    )

    router.add_api_route(
        path="/get_local_llm_data_analysis",
        endpoint=agent_controller.get_local_llm_data_analysis,
        methods=["POST"],
        summary="Выполнить анализ локальной/OpenAI-compatible моделью",
        description="Канонический endpoint универсального локального AI-провайдера"
    )

    router.add_api_route(
        path="/get_qwen_local_data_analysis",
        endpoint=agent_controller.get_qwen_local_data_analysis,
        methods=["POST"],
        summary="Legacy alias для локальной модели",
        description="Deprecated alias; новые клиенты используют get_local_llm_data_analysis"
    )

    return router
