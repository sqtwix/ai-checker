from fastapi import APIRouter, status    

def setup_routes(agent_controller):
    router = APIRouter()

    router.add_api_route(
        path="/get_deepseek_data_analysis",
        endpoint = agent_controller.get_deepseek_data_analysis,
        methods=["POST"],
        summary="Выполнить обрабокту данных используя группу агентов DeepSeek",
        description="Возвращает ai-response, который содержит результаты обработки данных группой агентов DeepSeek"
    )

    router.add_api_route(
        path="/get_sbergpt_data_analysis",
        endpoint = agent_controller.get_sbergpt_data_analysis,
        methods=["POST"],
        summary="Выполнить обрабокту данных используя группу агентов SberGPT",
        description="Возвращает ai-response, который содержит результаты обработки данных группой агентов SberGPT"
    )

    return router