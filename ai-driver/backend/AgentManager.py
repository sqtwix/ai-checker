from AgentClient import AgentClient
from AgentFactory import AgentFactory
import json
import concurrent.futures

# ========================= Agent Manager ========================= 

# AgentManager - class, that controls Agents Queues
# that was created by AgentFactory
# It contains to main methods

# start_deepseek_processing() - that method starts process
# with multithreads, that returns ai_responses data str in json_format
# with deepseek agents queue

# start_sbergpt_processing() - that method starts process
# with multithreads, that returns ai_responses data str in json_format
# with sbergpt agents queue

# One thread contains one agent client executing task
# that returns data from model api
# that realization will provide more fast data transfers 


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
            raise Exception("Agent Manager Initialization Error: " + e.__str__())

    def start_deepseek_processing(input_data : str, self) -> str:
        try:
            specializations = [
                "main-analyzer",
                "anomalies-analyzer",
                "statistics-summarizer"
            ]

            agents_count = len(self.deepseek_queue)

            with concurrent.futures.ThreadPoolExecutor(max_workers=len(specializations)) as executor:
                futures = {}
                for agent_idx, specialization in enumerate(specializations):
                    if agent_idx < len(self.deepseek_queue):
                        prompt = self.system_prompts[agent_idx]['prompt']
                        future = executor.submit(self.deepseek_queue[agent_idx].execute, (prompt, input_data))
                        futures[future] = specialization

                ai_responses = {}

                for future in concurrent.futures.as_completed(futures):
                    specialization = futures[future]
                    ai_responses[specialization] = future.result()

            return json.dumps(ai_responses)
        except Exception as e:
            raise Exception("DeepSeek Processing Error: " + e.__str__())

    def start_sbergpt_processing(input_data : str, self):
        try:
            specializations = [
                "main-analyzer",
                "anomalies-analyzer",
                "statistics-summarizer"
            ]

            agents_count = len(self.sbergpt_queue)

            with concurrent.futures.ThreadPoolExecutor(max_workers=len(specializations)) as executor:
                futures = {}
                for agent_idx, specialization in enumerate(specializations):
                    if agent_idx < len(self.sbergpt_queue):
                        prompt = self.system_prompts[agent_idx]['prompt']
                        future = executor.submit(self.sbergpt_queue[agent_idx].execute, (prompt, input_data))
                        futures[future] = specialization

                ai_responses = {}

                for future in concurrent.futures.as_completed(futures):
                    specialization = futures[future]
                    ai_responses[specialization] = future.result()

            return json.dumps(ai_responses)
        except Exception as e:
            raise Exception("SberGpt Processing Error: " + e.__str__())