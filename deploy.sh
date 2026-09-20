#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"
DEPLOY_ENV_FILE=${DEPLOY_ENV_FILE:-.env}
ENV_FILE_PATH="$DEPLOY_ENV_FILE" ./scripts/init_env.sh

while IFS='=' read -r key value; do
  value="${value%$'\r'}"
  case "$key" in
    DB_PASSWORD|JWT_SECRET|JWT_EXPIRY_MINUTES|FRONTEND_PORT|API_PORT|AI_DRIVER_PORT|ENABLED_MODELS|ENABLE_LOCAL_LLM|LOCAL_LLM_MODE|LOCAL_LLM_MODELS_DIR|LOCAL_LLM_MODEL_FILE|LOCAL_LLM_MODEL_URL|LOCAL_LLM_MODEL_SHA256|LOCAL_LLM_BASE_URL|LOCAL_LLM_MODEL|LOCAL_LLM_API_KEY|LOCAL_LLM_CONTEXT_SIZE|LOCAL_LLM_GPU_LAYERS|LOCAL_LLM_THREADS|LOCAL_LLM_BATCH_SIZE|LOCAL_LLM_PARALLEL|ALLOW_PROGRAMMATIC_FALLBACK|MAX_REQUEST_SIZE_MB|MAX_FILE_SIZE_MB|MAX_RESPONSE_FILE_COUNT|ANALYSIS_QUEUE_CAPACITY|ANALYSIS_MAX_ATTEMPTS|AI_PROVIDER_TIMEOUT_SECONDS|AI_PIPELINE_TIMEOUT_SECONDS|AI_MAX_OUTPUT_TOKENS)
      printf -v "$key" '%s' "$value" ;;
  esac
done < "$DEPLOY_ENV_FILE"

fail() { echo "ERROR: $*" >&2; exit 1; }
validate_port() {
  [[ "$2" =~ ^[0-9]+$ ]] && (( $2 >= 1 && $2 <= 65535 )) || fail "$1 must be an integer from 1 to 65535"
}
validate_number() {
  [[ "$2" =~ ^[0-9]+$ ]] && (( $2 >= $3 && $2 <= $4 )) || fail "$1 must be an integer from $3 to $4"
}

[[ ${#DB_PASSWORD} -ge 24 ]] || fail "DB_PASSWORD must contain at least 24 characters"
[[ ${#JWT_SECRET} -ge 32 ]] || fail "JWT_SECRET must contain at least 32 characters"
FRONTEND_PORT=${FRONTEND_PORT:-3000}; API_PORT=${API_PORT:-5000}; AI_DRIVER_PORT=${AI_DRIVER_PORT:-8000}
validate_port FRONTEND_PORT "$FRONTEND_PORT"; validate_port API_PORT "$API_PORT"; validate_port AI_DRIVER_PORT "$AI_DRIVER_PORT"
[[ "$FRONTEND_PORT" != "$API_PORT" && "$FRONTEND_PORT" != "$AI_DRIVER_PORT" && "$API_PORT" != "$AI_DRIVER_PORT" ]] || fail "published ports must be different"
validate_number JWT_EXPIRY_MINUTES "${JWT_EXPIRY_MINUTES:-60}" 5 10080
validate_number MAX_REQUEST_SIZE_MB "${MAX_REQUEST_SIZE_MB:-100}" 1 100
validate_number MAX_FILE_SIZE_MB "${MAX_FILE_SIZE_MB:-50}" 1 1024
validate_number MAX_RESPONSE_FILE_COUNT "${MAX_RESPONSE_FILE_COUNT:-50}" 1 1000
validate_number ANALYSIS_QUEUE_CAPACITY "${ANALYSIS_QUEUE_CAPACITY:-20}" 1 10000
validate_number ANALYSIS_MAX_ATTEMPTS "${ANALYSIS_MAX_ATTEMPTS:-3}" 1 10
validate_number AI_PROVIDER_TIMEOUT_SECONDS "${AI_PROVIDER_TIMEOUT_SECONDS:-360}" 30 900
validate_number AI_PIPELINE_TIMEOUT_SECONDS "${AI_PIPELINE_TIMEOUT_SECONDS:-1200}" 60 3600
validate_number AI_MAX_OUTPUT_TOKENS "${AI_MAX_OUTPUT_TOKENS:-1000}" 128 4096
(( ${AI_PIPELINE_TIMEOUT_SECONDS:-1200} > ${AI_PROVIDER_TIMEOUT_SECONDS:-360} )) || fail "AI_PIPELINE_TIMEOUT_SECONDS must exceed AI_PROVIDER_TIMEOUT_SECONDS"
(( ${MAX_FILE_SIZE_MB:-50} <= ${MAX_REQUEST_SIZE_MB:-100} )) || fail "MAX_FILE_SIZE_MB cannot exceed MAX_REQUEST_SIZE_MB"
fallback=$(printf '%s' "${ALLOW_PROGRAMMATIC_FALLBACK:-false}" | tr '[:upper:]' '[:lower:]')
[[ "$fallback" == true || "$fallback" == false ]] || fail "ALLOW_PROGRAMMATIC_FALLBACK must be true or false"

ENABLE_LOCAL_LLM=$(printf '%s' "${ENABLE_LOCAL_LLM:-false}" | tr '[:upper:]' '[:lower:]')
[[ "$ENABLE_LOCAL_LLM" == true || "$ENABLE_LOCAL_LLM" == false ]] || fail "ENABLE_LOCAL_LLM must be true or false"
LOCAL_LLM_MODE=$(printf '%s' "${LOCAL_LLM_MODE:-managed}" | tr '[:upper:]' '[:lower:]')
[[ "$LOCAL_LLM_MODE" == managed || "$LOCAL_LLM_MODE" == external ]] || fail "LOCAL_LLM_MODE must be managed or external"

if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE=(docker-compose)
else fail "Docker Compose is not installed"; fi
docker info >/dev/null 2>&1 || fail "Docker Engine is unavailable"

compose_cmd() {
  if [[ "$ENABLE_LOCAL_LLM" == true && "$LOCAL_LLM_MODE" == managed ]]; then
    "${COMPOSE[@]}" --env-file "$DEPLOY_ENV_FILE" --profile local-ai "$@"
  else
    "${COMPOSE[@]}" --env-file "$DEPLOY_ENV_FILE" "$@"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else fail "sha256sum or shasum is required"; fi
}

if [[ "$ENABLE_LOCAL_LLM" == true && "$LOCAL_LLM_MODE" == managed ]]; then
  file=${LOCAL_LLM_MODEL_FILE:-model.gguf}
  models_dir=${LOCAL_LLM_MODELS_DIR:-./models}
  path="$models_dir/$file"
  [[ "$file" != */* && "$file" != *\\* && "$file" == *.gguf ]] || fail "LOCAL_LLM_MODEL_FILE must be a .gguf basename"
  [[ -n "$models_dir" ]] || fail "LOCAL_LLM_MODELS_DIR cannot be empty"
  [[ "${LOCAL_LLM_MODEL_SHA256:-}" =~ ^[0-9A-Fa-f]{64}$ ]] || fail "LOCAL_LLM_MODEL_SHA256 is required in managed mode"
  validate_number LOCAL_LLM_CONTEXT_SIZE "${LOCAL_LLM_CONTEXT_SIZE:-8192}" 512 131072
  validate_number LOCAL_LLM_THREADS "${LOCAL_LLM_THREADS:-8}" 1 256
  validate_number LOCAL_LLM_BATCH_SIZE "${LOCAL_LLM_BATCH_SIZE:-512}" 1 8192
  validate_number LOCAL_LLM_PARALLEL "${LOCAL_LLM_PARALLEL:-1}" 1 16
  mkdir -p "$models_dir"
  if [[ ! -f "$path" ]]; then
    [[ "${LOCAL_LLM_MODEL_URL:-}" == https://* ]] || fail "copy $file to $models_dir or set an HTTPS LOCAL_LLM_MODEL_URL"
    command -v curl >/dev/null 2>&1 || fail "curl is required to download the model"
    part="$path.part"; trap 'rm -f "${part:-}"' EXIT
    curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' --output "$part" "$LOCAL_LLM_MODEL_URL"
    actual=$(sha256_file "$part" | tr '[:upper:]' '[:lower:]')
    expected=$(printf '%s' "$LOCAL_LLM_MODEL_SHA256" | tr '[:upper:]' '[:lower:]')
    [[ "$actual" == "$expected" ]] || fail "downloaded model checksum mismatch"
    mv "$part" "$path"; trap - EXIT
  else
    actual=$(sha256_file "$path" | tr '[:upper:]' '[:lower:]')
    expected=$(printf '%s' "$LOCAL_LLM_MODEL_SHA256" | tr '[:upper:]' '[:lower:]')
    [[ "$actual" == "$expected" ]] || fail "local model checksum mismatch"
  fi
elif [[ "$ENABLE_LOCAL_LLM" == true ]]; then
  [[ "${LOCAL_LLM_BASE_URL:-}" == http://* || "${LOCAL_LLM_BASE_URL:-}" == https://* ]] || fail "external LOCAL_LLM_BASE_URL must be HTTP(S)"
  case "$LOCAL_LLM_BASE_URL" in *localhost*|*127.0.0.1*|*"[::1]"*) fail "use host.docker.internal instead of localhost for a host model server";; esac
  [[ -n "${LOCAL_LLM_MODEL:-}" ]] || fail "LOCAL_LLM_MODEL is required in external mode"
fi

if [[ -n "${ENABLED_MODELS:-}" ]]; then
  IFS=',' read -ra model_ids <<< "$ENABLED_MODELS"
  for model in "${model_ids[@]}"; do
    model=$(printf '%s' "$model" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
    [[ -z "$model" ]] && continue
    case "$model" in
      deepseek) [[ -n "${DEEPSEEK_API_KEY:-$(sed -n 's/^DEEPSEEK_API_KEY=//p' "$DEPLOY_ENV_FILE")}" ]] || fail "deepseek is enabled but DEEPSEEK_API_KEY is empty" ;;
      gigachat) [[ -n "${SBERGPT_API_KEY:-$(sed -n 's/^SBERGPT_API_KEY=//p' "$DEPLOY_ENV_FILE")}" ]] || fail "gigachat is enabled but SBERGPT_API_KEY is empty" ;;
      local_llm) [[ "$ENABLE_LOCAL_LLM" == true ]] || fail "local_llm is enabled but ENABLE_LOCAL_LLM is false" ;;
      *) fail "unsupported model in ENABLED_MODELS: $model" ;;
    esac
  done
fi

echo "Validating Compose configuration..."
compose_cmd config --quiet
if [[ "$ENABLE_LOCAL_LLM" == false || "$LOCAL_LLM_MODE" == external ]]; then
  "${COMPOSE[@]}" --env-file "$DEPLOY_ENV_FILE" --profile local-ai rm -sf local-llm >/dev/null 2>&1 || true
fi
echo "Building production images..."
compose_cmd build
echo "Starting services..."
compose_cmd up --no-build -d --remove-orphans

services=(postgres ai-driver api-core frontend)
[[ "$ENABLE_LOCAL_LLM" == true && "$LOCAL_LLM_MODE" == managed ]] && services+=(local-llm)
startup_timeout=300
[[ "$ENABLE_LOCAL_LLM" == true && "$LOCAL_LLM_MODE" == managed ]] && startup_timeout=900
deadline=$((SECONDS + startup_timeout))
for service in "${services[@]}"; do
  while true; do
    id=$(compose_cmd ps -q "$service")
    state=$([[ -n "$id" ]] && docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)
    [[ "$state" == healthy ]] && { echo "$service: healthy"; break; }
    [[ "$state" == unhealthy || "$state" == exited || "$state" == dead ]] && fail "$service entered $state; inspect Compose logs"
    (( SECONDS < deadline )) || fail "timed out waiting for $service"
    sleep 2
  done
done

if [[ "$ENABLE_LOCAL_LLM" == true ]]; then
  echo "Running local model inference probe..."
  compose_cmd exec -T ai-driver python -c 'from backend.model_availability import verify_local_inference; raise SystemExit(0 if verify_local_inference() else 1)' \
    || fail "local model passed HTTP health but failed chat inference"
fi

smoke_args=(--base-url "http://frontend:8080")
[[ -z "${ENABLED_MODELS:-}" ]] && smoke_args+=(--expect-no-ai)
cleanup_smoke_users() {
  compose_cmd exec -T postgres sh -lc \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DELETE FROM users WHERE email LIKE \$\$smoke-%@example.test\$\$;"' \
    >/dev/null
}
cleanup_smoke_users
if ! compose_cmd exec -T ai-driver python - "${smoke_args[@]}" < scripts/smoke_stack.py; then
  cleanup_smoke_users || true
  fail "stack smoke test failed"
fi
cleanup_smoke_users
echo "Deployment complete: http://localhost:$FRONTEND_PORT"
