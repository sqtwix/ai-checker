# Базовый образ llama.cpp с уже собранным сервером
FROM ghcr.io/ggml-org/llama.cpp:server@sha256:2e22fe614481e58c56ba665399b015fc8906a20203a20843e91c06e3fbed7e47

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
# Large GGUF files mounted from Docker Desktop/Colima can need several minutes
# for the initial sequential read. Keep the container in "starting" state while
# llama.cpp is legitimately loading instead of reporting a false failure.
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD curl --silent --show-error --fail http://localhost:8080/health || exit 1

# Открываем порт для API
EXPOSE 8080

# Запускаем сервер через entrypoint или напрямую
ENTRYPOINT ["/entrypoint.sh"]
