from pydantic import BaseModel

class MainAnalysis(BaseModel):
    correct_count : int
    wrong_count : int
    verdict : str