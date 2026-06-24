#!/bin/bash
set -e

# Проверяем наличие модели
MODEL_PATH=${MODEL_PATH:-/models/qwen3-8b.Q4_K_M.gguf}

if [ ! -f "$MODEL_PATH" ]; then
    echo "ERROR: Model file not found at $MODEL_PATH"
    echo "Available files in /models:"
    ls -la /models/
    exit 1
fi

echo "Starting llama.cpp server with model: $MODEL_PATH"
echo "Host: ${SERVER_HOST:-0.0.0.0}"
echo "Port: ${SERVER_PORT:-8080}"
echo "Context size: ${N_CTX:-8192}"

# Запуск OpenAI-совместимого сервера llama.cpp
exec /llama-server \
    -m "$MODEL_PATH" \
    --host "${SERVER_HOST:-0.0.0.0}" \
    --port "${SERVER_PORT:-8080}" \
    --ctx-size "${N_CTX:-8192}" \
    --n-gpu-layers "${N_GPU_LAYERS:-0}" \
    --threads "${N_THREADS:-4}" \
    --batch-size "${BATCH_SIZE:-512}" \
    --alias "${MODEL_ALIAS:-local-model}"