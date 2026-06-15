from pydantic import BaseModel, ConfigDict

class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra='allow')