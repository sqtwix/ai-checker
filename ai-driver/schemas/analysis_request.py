from pydantic import BaseModel

class AnalysisRequest(BaseModel):
    question_text: str
    correct_answer: str
    user_answer: str
    time_spent_seconds: int