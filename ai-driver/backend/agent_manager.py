from backend.agent_client import AgentClient
from backend.agent_factory import AgentFactory
import json
import logging
from pathlib import Path

# ========================= Agent Manager =========================

# AgentManager - class, that controls Agents Queues
# that was created by AgentFactory
# It contains methods for processing with different model types

# start_processing() - main method that starts multi-agent pipeline
# with sequential agent execution according to role model:
#   1. main-analyzer - analyzes answers, finds errors
#   2. anomalies-analyzer - detects anomalies using results from step 1
#   3. statistics-summarizer - compiles final report using results from steps 1 and 2

# This sequential approach ensures that each agent builds upon
# the context and findings of the previous one, as required by TZ.

BASE_DIR = Path(__file__).resolve().parent
PATH_TO_JSON = BASE_DIR / "system_prompts.json"

# Настройка логгера
logger = logging.getLogger(__name__)

class AgentManager:
    def __init__(self, agent_factory: AgentFactory):
        try:
            self.agent_factory = agent_factory
            # Загружаем системные промпты для всех специализаций
            with open(PATH_TO_JSON, "r") as f:
                row_context = f.read()
                self.system_prompts = json.loads(row_context)
        except Exception as e:
            raise Exception("Agent Manager Initialization Error: " + str(e))

    def start_deepseek_processing(self, input_data: str) -> str:
        # Запускает конвейер агентов DeepSeek.
        # Агенты выполняются последовательно, передавая контекст друг другу.
        return self._run_pipeline(input_data, "deepseek")

    def start_sbergpt_processing(self, input_data: str) -> str:
        # Запускает конвейер агентов SberGPT.
        # Агенты выполняются последовательно, передавая контекст друг другу.
        return self._run_pipeline(input_data, "sbergpt")

    def start_qwen_local_processing(self, input_data: str) -> str:
        # Запускает конвейер агентов на локальной модели Qwen.
        # Агенты выполняются последовательно, передавая контекст друг другу.
        return self._run_pipeline(input_data, "qwen_local")

    def _run_pipeline(self, input_data: str, model_type: str) -> str:
        # Внутренний метод, реализующий последовательный конвейер агентов.
        # Параметры:
        #   input_data - JSON-строка с данными от api-core
        #   model_type - тип модели ("deepseek", "sbergpt", "qwen_local")
        # Возвращает:
        #   str - JSON-строка с финальным отчетом

        try:
            # Получаем очередь агентов от фабрики
            agent_queue = self.agent_factory.create_queue(model_type)

            # Распаковываем агентов по ролям
            agent_analyzer = agent_queue[0]     # main-analyzer
            agent_anomalist = agent_queue[1]    # anomalies-analyzer
            agent_statistician = agent_queue[2] # statistics-summarizer

            # Шаг 1: Анализ ответов и сравнение с эталоном
            logger.info("[%s] Step 1: main-analyzer starting", model_type)
            analysis_result_str = agent_analyzer.execute(
                self.system_prompts[0]["prompt"],
                input_data
            )
            analysis_result = json.loads(analysis_result_str)

            # Шаг 2: Поиск аномалий (передаем исходные данные + результаты шага 1)
            logger.info("[%s] Step 2: anomalies-analyzer starting", model_type)
            enriched_input = json.dumps({
                "original_data": json.loads(input_data),
                "main_analysis": analysis_result
            }, ensure_ascii=False)
            anomaly_result_str = agent_anomalist.execute(
                self.system_prompts[1]["prompt"],
                enriched_input
            )
            anomaly_result = json.loads(anomaly_result_str)

            # Шаг 3: Финальная статистика и отчет (передаем результаты шагов 1 и 2)
            logger.info("[%s] Step 3: statistics-summarizer starting", model_type)
            final_input = json.dumps({
                "main_analysis": analysis_result,
                "anomaly_analysis": anomaly_result
            }, ensure_ascii=False)
            final_report_str = agent_statistician.execute(
                self.system_prompts[2]["prompt"],
                final_input
            )

            logger.info("[%s] Pipeline completed successfully", model_type)
            return final_report_str

        except json.JSONDecodeError as e:
            raise Exception("[%s] Pipeline JSON Error: invalid JSON from agent - %s" % (model_type, str(e)))
        except Exception as e:
            raise Exception("[%s] Pipeline Processing Error: %s" % (model_type, str(e)))