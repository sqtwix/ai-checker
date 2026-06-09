from AgentClient import AgentClient
import os

class AgentFactory:
    @staticmethod
    def create_queue(model: str) -> list[AgentClient] :
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






