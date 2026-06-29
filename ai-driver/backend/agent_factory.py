from backend.agent_client import AgentClient
import os

# ========================= Agent Factory =========================

# AgentFactory - class, that used to create a queue of agents
# that class provide a static method, which creates th Agents Queue
# thats will be operate by AgentManager

# AgentManager will get Agents from factory and call execute metod from AgentClient
# AgentFactory can create both groups of Agent (DeepSeek, SberGpt and local Qwen)

# DeepSeek use DEEPSEEK_ global variables from dotenv
# SberGpt use SBERGPT_ global variables from dotenv
# Local Qwen use QWEN_LOCAL_ global variables from dotenv
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

            case "qwen_local":
                # llama.cpp OpenAI-совместимый сервер:
                # - не требует аутентификации
                # - base_url должен заканчиваться на /v1
                # - model это алиас установленный через --alias
                api_key = "not-needed"
                base_url = os.getenv("QWEN_LOCAL_URL", "http://localhost:8080/v1")
                agent_model = os.getenv("QWEN_LOCAL_MODEL", "local-model")

            case _:
                raise Exception("AgentFabric Creating Queue Exception: unsupported model type - " + model)

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