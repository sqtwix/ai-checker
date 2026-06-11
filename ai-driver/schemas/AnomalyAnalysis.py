from pydantic import BaseModel

class AnomalyAnalysis(BaseModel):
    anomalies : list[str]
    anomalies_descriptions : list[str]
    verdict : str