from AgentClient import AgentClient
import os

# ========================= Agent Factory ========================= 

# AgentFactory - class, that used to create a queue of agents
# that class provide a static method, which creates th Agents Queue
# thats will be operate by AgentManager

# AgentManager will get Agents from factory and call execute metod from AgentClient
# AgentFactory can create both groups of Agent (DeepSeek and SberGpt)

# DeepSeek use DEEPSEEK_ global variables from dotenv
# SberGpt use SBERGPT_ global variables from dotenv

class AgentFactory:
    def __init__(self):
        ...

    def create_queue(model: str, self) -> list[AgentClient] :
        queue : list[AgentClient] = []
        specializations = [
            "main-analyzer",
            "anomalies-analyzer",
            "statistics-summarizer"
        ]

        match model:
            case "deepseek":
                    api_key : str = os.getenv("DEEPSEEK_API_KEY")
                    base_url : str = os.getenv("DEEPSEEK_BASE_URL")
                    agent_model : str = os.getenv("DEEPSEEK_MODEL")
                
            case "sbergpt":
                    api_key : str = os.getenv("SBERGPT_API_KEY")
                    base_url : str = os.getenv("SBERGPT_BASE_URL")
                    agent_model : str = os.getenv("SBERGPT_MODEL")

        try:
            for specialization in specializations:
                queue.append(
                    AgentClient(
                        api_key = api_key,
                        base_url = base_url,
                        agent_model = agent_model,
                        specialization = specialization
                    )
                )
                
            return queue
        except Exception as e:
            raise Exception("AgentFabric Creating Queue Exception: " + e.__str__())






