from backend.agent_client import AgentClient
import os

# ========================= Agent Factory =========================

# AgentFactory - class, that used to create a queue of agents
# that class provide a static method, which creates th Agents Queue
# thats will be operate by AgentManager

# AgentManager will get Agents from factory and call execute metod from AgentClient
# AgentFactory creates DeepSeek, GigaChat and OpenAI-compatible local agents.

# DeepSeek use DEEPSEEK_ global variables from dotenv
# SberGpt use SBERGPT_ global variables from dotenv
# Legacy QWEN_LOCAL_ variables are accepted only for compatibility.
# For llama.cpp the base_url must end with /v1
# Model name must match --alias parameter of llama-server

class AgentFactory:

    SPECIALIZATIONS = [
        "main-analyzer",
        "anomalies-analyzer",
        "statistics-summarizer"
    ]

    def create_queue(self, model: str) -> list:

        queue: list = []

        api_key: str = None
        base_url: str = None
        agent_model: str = None

        match model:
            case "deepseek":
                api_key = os.getenv("DEEPSEEK_API_KEY")
                base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
                agent_model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

            case "sbergpt":
                api_key = os.getenv("SBERGPT_API_KEY")
                base_url = os.getenv("SBERGPT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1/")
                agent_model = os.getenv("SBERGPT_MODEL", "GigaChat-Pro")

            case "local_llm" | "qwen_local" | "qwen" | "local":
                api_key = os.getenv("LOCAL_LLM_API_KEY") or "not-needed"
                base_url = os.getenv("LOCAL_LLM_BASE_URL") or os.getenv("QWEN_LOCAL_URL", "http://localhost:8080/v1")
                agent_model = os.getenv("LOCAL_LLM_MODEL") or os.getenv("QWEN_LOCAL_MODEL", "local-model")

            case _:
                raise Exception("AgentFabric Creating Queue Exception: unsupported model type - " + model)

        if model in {"deepseek", "sbergpt"} and not api_key:
            raise Exception(f"{model} API key is not configured")

        try:
            for specialization in self.SPECIALIZATIONS:
                queue.append(
                    AgentClient(
                        api_key=api_key,
                        base_url=base_url,
                        agent_model=agent_model,
                        specialization=specialization
                    )
                )

            if len(queue) != 3:
                raise Exception(
                    "AgentFabric Creating Queue Exception: expected 3 agents, got " + str(len(queue))
                )

            return queue

        except Exception as e:
            raise Exception("AgentFabric Creating Queue Exception: " + str(e))
