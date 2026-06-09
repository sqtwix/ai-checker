from openai import OpenAI

# AgentClient - class, that present an Agent.
# AgnetClient class contains a basic constructor
# and execute method that used to get data from
# model API (DeepSeek and Sber GPT)

# DeepSeek JSON-fromat:
# {
# "model": "deepseek-v4-pro",
#         "messages": [
#           {"role": "system", "content": "You are a helpful assistant."},
#           {"role": "user", "content": "Hello!"}
#         ],
#         "thinking": {"type": "enabled"},
#         "reasoning_effort": "high",
#         "stream": false
#       }'

# Sber GPT JSON-fromat
# {
#   "model": "GigaChat-2-Max",
#   "messages": [
#     {
#       "role": "user",
#       "content": "Создай профиль пользователя для Ивана, 30 лет, локация Москва."
#     }
#   ],
#   "response_format": {
#     "type": "json_schema",
#     "json_schema": {
#       "name": "user_profile",
#       "strict": true,
#       "schema": {
#         "type": "object",
#         "properties": {
#           "name": { "type": "string" },
#           "age": { "type": "integer" },
#           "city": { "type": "string" }
#         },
#         "required": ["name", "age", "city"],
#         "additionalProperties": false
#       }
#     }
#   }
# }

# In this class, we use a general JSON-format
# {
#     model: "Model",
#     messages: [
#         {"role": "ROLE", "content": "CONTENT"}
#     ],
#     response_format = {"type" : "json_object"},
#     temperature = 0.3
# }

class AgentClient:
    def __init__(api_key: str, base_url: str, model: str,  self):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def execute(system_prompt: str, user_prompt: str, self) -> any:
        try:
            response = self.client.chat.completions.create(
                model = self.model,
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format = {"type": "json_object"},
                temperature = 0.3
            )

            return response.choices[0].message.content
        except Exception as e:
            raise Exception("AgentClient Execution Exception: Prompt execution failed")
        
    def get_agent_model_type(self) -> str:
        return self.model;
