from pydantic import BaseModel

from MainAnalysis import MainAnalysis
from AnomalyAnalysis import AnomalyAnalysis
from StatisticsAnalysis import StatisticsAnalysis

class AnalysisResponse(BaseModel):
    main_analysis : MainAnalysis
    AnomalyAnalysis : AnomalyAnalysis
    statistics_analysis : StatisticsAnalysis