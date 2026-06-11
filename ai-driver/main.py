from fastapi import FastAPI, APIRouter
import os

from backend.agent_client import AgentClient
from backend.agent_factory import AgentFactory
from backend.agent_manager import AgentManager
from controllers.agent_controller import AgentController
from routes import setup_routes

app = FastAPI(
    title="Agents API",
    description="Документация к AgentsAPI API",
    version="1.0.0",
    swagger_ui_parameters={"syntaxHighlight.theme": "obsidian"}
)

agent_factory = AgentFactory()
agent_manager = AgentManager(agent_factory=agent_factory)
agent_controller = AgentController(agent_manager=agent_manager)

app.include_router(setup_routes(agent_controller=agent_controller), prefix="/agents")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
