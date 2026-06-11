from AgentClient import AgentClient
from AgentFactory import AgentFactory

class AgentManager:
    def __init__(agent_factory : AgentFactory, self):
        self.agent_factory = agent_factory
    
    def setup_deepseek_queue(self):
        self.deepseek_queue : list[AgentClient] = self.agent_factory.create_queue("deepseek")

    def setup_sbergpt_queue(self):
        self.sbergpt_queue : list[AgentClient] = self.agent_factory.create_queue("sbergpt")

    def start_deepseek_processing(input_data : str, self):
        

    def start_sbergpt_processing(input_data : str, self):
        ...