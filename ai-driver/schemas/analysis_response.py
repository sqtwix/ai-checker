from pydantic import BaseModel
from schemas.main_analysis import MainAnalysis
from schemas.anomaly_analysis import AnomalyAnalysis
from schemas.statistics_analysis import StatisticsAnalysis

class AnalysisResponse(BaseModel):
    main_analysis: MainAnalysis
    anomaly_analysis: AnomalyAnalysis 
    statistics_analysis: StatisticsAnalysis

AnalysisResponse.model_rebuild()