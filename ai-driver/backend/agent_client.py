from openai import OpenAI
import json
import logging
from backend.cancellation import check_cancelled
import os

# ========================= Agent Client =========================

# AgentClient - class, that present an Agent.
# AgnetClient class contains a basic constructor
# and execute method that used to get data from
# model API (DeepSeek, GigaChat, local OpenAI-compatible runtime).

# ========================= General JSON-Format =========================
# {
#     model: "Model",
#     messages: [
#         {"role": "ROLE", "content": "CONTENT"}
#     ],
#     response_format = {"type" : "json_object"},
#     temperature = 0.3
# }

# Для локальной модели через vllm используется тот же формат,
# так как vllm поднимает OpenAI-совместимый сервер.
# api_key для локальной модели передается как "not-needed".

# Настройка логгера для отслеживания работы агентов
logger = logging.getLogger(__name__)


class AgentTransportError(Exception):
    pass


class AgentSemanticError(Exception):
    pass

class AgentClient:
    def __init__(self, api_key: str, base_url: str, agent_model: str, specialization: str):
        # Проверяем обязательные параметры перед инициализацией
        if not base_url or not agent_model:
            raise Exception("AgentClient Initialization Exception: base_url and agent_model are required")
        try:
            self.api_key = api_key
            self.base_url = base_url
            self.model = agent_model
            self.specialization = specialization
            # OpenAI клиент работает для всех совместимых API (DeepSeek, GigaChat, vLLM)
            # Durable retries belong to the PostgreSQL job queue. SDK retries
            # would duplicate expensive inference without changing task state.
            self.client = OpenAI(api_key=self.api_key, base_url=self.base_url, max_retries=0)
        except Exception as e:
            raise Exception("AgentClient Initialization Exception: agent initialization failed - " + str(e))

    def execute(self, system_prompt: str, user_prompt: str, *, response_schema: dict | None = None) -> str:
        # Выполняет запрос к модели и возвращает JSON-строку с ответом.
        # Параметры:
        #   system_prompt - системный промпт, определяющий роль агента
        #   user_prompt   - данные для анализа в JSON-формате
        # Возвращает:
        #   str - валидная JSON-строка с результатом работы модели
        # Исключения:
        #   Exception - при ошибках API, таймаутах или невалидном JSON в ответе

        check_cancelled()
        logger.info("Agent [%s] starting with model %s", self.specialization, self.model)

        try:
            timeout_seconds = max(30, min(900, int(os.getenv("AI_PROVIDER_TIMEOUT_SECONDS", "360"))))
            max_output_tokens = max(128, min(4096, int(os.getenv("AI_MAX_OUTPUT_TOKENS", "1000"))))
            response_format = {"type": "json_object"}
            if response_schema is not None:
                response_format = {
                    "type": "json_schema",
                    "json_schema": {"name": "analysis", "strict": True, "schema": response_schema},
                }
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format=response_format,
                temperature=0.3,
                max_tokens=max_output_tokens,
                timeout=timeout_seconds
            )

        except Exception as e:
            check_cancelled()
            logger.error("Agent [%s] transport failed: %s", self.specialization, str(e))
            raise AgentTransportError("provider request failed") from e

        check_cancelled()
        try:
            if response.choices[0].finish_reason == "length":
                raise ValueError("model response reached AI_MAX_OUTPUT_TOKENS before completion")
            raw_content = response.choices[0].message.content
            normalized_content = self._normalize_json_object(raw_content)
            parsed = json.loads(normalized_content)
            if not isinstance(parsed, dict):
                raise ValueError("top-level JSON value must be an object")

            logger.info("Agent [%s] completed successfully", self.specialization)
            return normalized_content
        except Exception as e:
            logger.warning("Agent [%s] returned unusable JSON: %s", self.specialization, str(e))
            raise AgentSemanticError("model returned invalid structured content") from e

    @staticmethod
    def _normalize_json_object(content: str) -> str:
        """Accept a JSON object or one JSON object wrapped in a Markdown fence."""
        if not isinstance(content, str):
            raise ValueError("model returned no text content")
        stripped = content.strip()
        if not stripped.startswith("```"):
            return stripped
        lines = stripped.splitlines()
        if len(lines) < 3 or lines[-1].strip() != "```":
            return stripped
        language = lines[0].strip().lower()
        if language not in {"```", "```json"}:
            return stripped
        return "\n".join(lines[1:-1]).strip()
