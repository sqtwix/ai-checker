from pydantic import BaseModel

# Схема входных данных (то, что пришлет нам .NET Core)
class AnalysisRequest(BaseModel):
    question_text: str
    correct_answer: str
    user_answer: str
    time_spent_seconds: int