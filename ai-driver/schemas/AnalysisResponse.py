from pydantic import BaseModel

# Схема выходных данных (то, что ИИ обязан вернуть строго по структуре)
class AnalysisResponse(BaseModel):
    is_correct: bool
    score_percent: int
    logic_difference: str
    time_anomaly_detected: bool
    time_verdict: str