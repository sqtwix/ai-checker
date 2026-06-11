from AgentClient import AgentClient
from AgentFactory import AgentFactory
import json
import concurrent.futures

class AgentManager:
    def __init__(agent_factory : AgentFactory, self):
        try:
            self.agent_factory = agent_factory
            self.deepseek_queue = self.agent_factory.create_queue("deepseek")
            self.sbergpt_queue = self.agent_factory.create_queue("sbergpt")
            with open("system_prompts.json", "r") as f:
                row_context = f.read()
                self.system_prompts = json.loads(row_context)
        except Exception as e:
            raise Exception("Agent Managet Initialization Error: " + e.__str__())

    def start_deepseek_processing(input_data : str, self) -> str:
        try:
            ai_responses = {
                "main-analyzer" : "",
                "anomalies-analyzer" : "",
                "statistics-summarizer" : ""
            }

            agents_count = len(self.deepseek_queue)

            for specialization in ai_responses.keys():
                agent_idx = 0
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(self.deepseek_queue[agent_idx].execute, (self.system_prompts[agent_idx]['prompt'], input_data))
                    ai_responses[specialization] = future.result()

            return json.dumps(ai_responses)
        except Exception as e:
            raise Exception("DeepSeek Processing Error: " + e.__str__())

    def start_sbergpt_processing(input_data : str, self):
        try:
            ai_responses = {
                "main-analyzer" : "",
                "anomalies-analyzer" : "",
                "statistics-summarizer" : ""
            }

            agents_count = len(self.sbergpt_queue)

            for specialization in ai_responses.keys():
                agent_idx = 0
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(self.sbergpt_queue[agent_idx].execute, (self.system_prompts[agent_idx]['prompt'], input_data))
                    ai_responses[specialization] = future.result()

            return json.dumps(ai_responses)
        except Exception as e:
            raise Exception("SberGpt Processing Error: " + e.__str__())