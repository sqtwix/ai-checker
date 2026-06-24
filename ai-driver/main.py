from fastapi import FastAPI, APIRouter
import os
import logging

from backend.agent_client import AgentClient
from backend.agent_factory import AgentFactory
from backend.agent_manager import AgentManager
from controllers.agent_controller import AgentController
from routes import setup_routes

# ========================= Main Application =========================

# Настройка логирования для отслеживания работы всех модулей
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

app = FastAPI(
    title="Agents API",
    description="Документация к AgentsAPI API. Поддерживает DeepSeek, SberGPT и локальный Qwen.",
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)