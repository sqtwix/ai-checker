# Базовый образ llama.cpp с уже собранным сервером
FROM ghcr.io/ggml-org/llama.cpp:server

# Установка curl для healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Создаем директорию для моделей внутри контейнера
RUN mkdir -p /models

# Копируем entrypoint скрипт если используется
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Healthcheck для проверки готовности сервера
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD curl -f http://localhost:8080/health || exit 1

# Открываем порт для API
EXPOSE 8080

# Запускаем сервер через entrypoint или напрямую
ENTRYPOINT ["/entrypoint.sh"]