from pydantic import BaseModel

class StatisticsAnalysis(BaseModel):
    correct_procent : float
    wrong_procent : float
    anomalies_count : float