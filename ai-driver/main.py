from fastapi import FastAPI, APIRouter, Request
import os
import logging
import re
import time
import uuid

from backend.agent_client import AgentClient
from backend.agent_factory import AgentFactory
from backend.agent_manager import AgentManager
from controllers.agent_controller import AgentController
from routes import setup_routes
from backend.model_availability import get_model_availability

# ========================= Main Application =========================

# Настройка логирования для отслеживания работы всех модулей
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

app = FastAPI(
    title="Agents API",
    description="AI pipeline для DeepSeek, GigaChat и локального OpenAI-compatible провайдера.",
    version="1.0.0",
    swagger_ui_parameters={"syntaxHighlight.theme": "obsidian"}
)

# Инициализация компонентов системы
# AgentFactory создает агентов для разных провайдеров
# AgentManager управляет конвейером последовательной обработки
# AgentController обрабатывает HTTP-запросы и валидирует данные
agent_factory = AgentFactory()
agent_manager = AgentManager(agent_factory=agent_factory)
agent_controller = AgentController(agent_manager=agent_manager)

# Регистрация маршрутов с префиксом /agents
app.include_router(setup_routes(agent_controller=agent_controller), prefix="/agents")

@app.middleware("http")
async def correlation_logging(request: Request, call_next):
    incoming = request.headers.get("X-Correlation-ID", "")
    correlation_id = incoming if re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", incoming) else uuid.uuid4().hex
    started = time.monotonic()
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    logging.getLogger("http").info(
        "correlation_id=%s method=%s path=%s status=%s elapsed_ms=%.1f",
        correlation_id, request.method, request.url.path, response.status_code,
        (time.monotonic() - started) * 1000,
    )
    return response

@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}

@app.get("/models/availability", tags=["system"])
def models_availability():
    return get_model_availability()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
