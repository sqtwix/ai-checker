from backend.agent_manager import AgentManager
from schemas.analysis_response import AnalysisResponse
from fastapi import HTTPException

class AgentController:
    def __init__(self, agent_manager : AgentManager):
        self.agent_manager = agent_manager

    def get_deepseek_data_analysis(self, input_data : str):
        try:
            ai_responses = self.agent_manager.start_deepseek_processing(input_data=input_data)
            return AnalysisResponse.model_validate_json(ai_responses)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Get data from DeepSeek Error: {e.__str__()}") 
        
    def get_sbergpt_data_analysis(self, input_data : str):
        try:
            ai_responses = self.agent_manager.start_sbergpt_processing(input_data=input_data)
            return AnalysisResponse.model_validate_json(ai_responses)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Get data from SberGPT Error: {e.__str__()}")