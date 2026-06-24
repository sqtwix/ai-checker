from backend.agent_manager import AgentManager
from schemas.analysis_response import AnalysisResponse
from schemas.analysis_request import AnalysisRequest
from fastapi import HTTPException
from fastapi.responses import JSONResponse

class AgentController:
    def __init__(self, agent_manager: AgentManager):
        self.agent_manager = agent_manager

    def get_deepseek_data_analysis(self, input_data: AnalysisRequest) -> AnalysisResponse:
        # Запускает анализ данных через группу агентов DeepSeek.
        # Выполняет валидацию входных данных перед отправкой.
        try:
            # Валидация входных данных
            self._validate_request(input_data)
            # Запуск конвейера агентов DeepSeek
            ai_responses = self.agent_manager.start_deepseek_processing(
                input_data=input_data.model_dump_json()
            )
            # Валидация и возврат ответа
            return AnalysisResponse.model_validate_json(ai_responses)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=500, detail="DeepSeek response is not valid JSON: " + str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail="Get data from DeepSeek Error: " + str(e))

    def get_sbergpt_data_analysis(self, input_data: AnalysisRequest) -> AnalysisResponse:
        # Запускает анализ данных через группу агентов SberGPT.
        # Выполняет валидацию входных данных перед отправкой.
        try:
            # Валидация входных данных
            self._validate_request(input_data)
            # Запуск конвейера агентов SberGPT
            ai_responses = self.agent_manager.start_sbergpt_processing(
                input_data=input_data.model_dump_json()
            )
            # Валидация и возврат ответа
            return AnalysisResponse.model_validate_json(ai_responses)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=500, detail="SberGPT response is not valid JSON: " + str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail="Get data from SberGPT Error: " + str(e))

    def get_qwen_local_data_analysis(self, input_data: AnalysisRequest) -> AnalysisResponse:
        # Запускает анализ данных через локальную модель Qwen.
        # Выполняет валидацию входных данных перед отправкой.
        try:
            # Валидация входных данных
            self._validate_request(input_data)
            # Запуск конвейера агентов Qwen Local
            ai_responses = self.agent_manager.start_qwen_local_processing(
                input_data=input_data.model_dump_json()
            )
            # Валидация и возврат ответа
            return AnalysisResponse.model_validate_json(ai_responses)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=500, detail="Qwen Local response is not valid JSON: " + str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail="Get data from Qwen Local Error: " + str(e))

    def _validate_request(self, input_data: AnalysisRequest):
        # Валидирует входные данные на соответствие бизнес-правилам.
        # Проверяет наличие тестов, попыток студентов, эталонных ответов.
        # При обнаружении проблем выбрасывает HTTPException с кодом 400.

        errors: list = []

        if not input_data.tests:
            errors.append("В запросе отсутствуют тесты для анализа")

        for test_idx, test in enumerate(input_data.tests):
            # Проверка наличия попыток студентов
            if not test.student_attempts:
                errors.append(
                    "В тесте '" + test.test_name + "' отсутствуют попытки студентов"
                )

            # Проверка наличия эталонных ответов в вопросах
            for question in test.questions:
                if not question.reference_answer:
                    errors.append(
                        "В вопросе '" + question.question_id + "' теста '" +
                        test.test_name + "' отсутствует эталонный ответ"
                    )

            # Проверка времени выполнения (не может быть отрицательным)
            for attempt in test.student_attempts:
                for answer in attempt.answers:
                    if answer.time_spent_seconds < 0:
                        errors.append(
                            "У студента " + attempt.student_id +
                            " в вопросе " + answer.question_id +
                            " указано отрицательное время выполнения"
                        )

        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))

        return input_data