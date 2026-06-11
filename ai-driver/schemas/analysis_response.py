from pydantic import BaseModel

from main_analysis import MainAnalysis
from anomaly_analysis import AnomalyAnalysis
from statistics_analysis import StatisticsAnalysis

class AnalysisResponse(BaseModel):
    main_analysis : MainAnalysis
    AnomalyAnalysis : AnomalyAnalysis
    statistics_analysis : StatisticsAnalysis