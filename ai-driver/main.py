from fastapi import FastAPI, APIRouter

from backend.agent_client import AgentClient
from backend.agent_factory import AgentFactory
from backend.agent_manager import AgentManager
from controllers.agent_controller import AgentController
from routes import setup_routes

if __name__ == "__main__":
    app = FastAPI(
        title="Мой API",
        description="Документация к моему API",
        version="1.0.0",
        swagger_ui_parameters={"syntaxHighlight.theme": "obsidian"}
    )
    router = APIRouter()
    agent_factory = AgentFactory()
    agent_manager = AgentManager(agent_factory=agent_factory)
    agent_controller = AgentController(agent_manager=agent_manager)
    app.include_router(setup_routes(agent_controller=agent_controller), prefix="/agents")