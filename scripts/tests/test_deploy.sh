#!/usr/bin/env bash
# Exercise deploy's CLI and Compose handoff without Docker or a real model.
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work_dir=$(mktemp -d "$ROOT_DIR/.deploy-test.XXXXXX")
cleanup() {
  local status=$?
  if (( status != 0 )); then
    for log in "$work_dir"/*.log; do
      [[ ! -f "$log" ]] || tail -n 20 "$log"
    done
  fi
  case "$work_dir" in
    "$ROOT_DIR"/.deploy-test.*) rm -rf -- "$work_dir" ;;
  esac
}
trap cleanup EXIT
mkdir -p "$work_dir/bin" "$work_dir/project/scripts" "$work_dir/project/models"
cp "$ROOT_DIR/deploy.sh" "$ROOT_DIR/.env.example" "$work_dir/project/"
cp "$ROOT_DIR/scripts/init_env.sh" "$ROOT_DIR/scripts/smoke_stack.py" "$work_dir/project/scripts/"
chmod +x "$work_dir/project/scripts/init_env.sh"

cat > "$work_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_TEST_LOG"
case "$1" in
  info|ps) exit 0 ;;
  inspect) echo healthy; exit 0 ;;
  compose)
    shift
    while [[ "${1:-}" == --env-file || "${1:-}" == --profile ]]; do shift 2; done
    case "${1:-}" in
      version|config|up|rm|exec) exit 0 ;;
      build)
        printf 'build-env: ENABLE_LOCAL_LLM=%s ENABLED_MODELS=%s\n' \
          "${ENABLE_LOCAL_LLM:-unset}" "${ENABLED_MODELS:-unset}" >> "$DOCKER_TEST_LOG"
        exit 0 ;;
      ps) echo "test-container"; exit 0 ;;
    esac ;;
esac
echo "Unexpected Docker invocation" >&2
exit 1
EOF
cat > "$work_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "Unexpected download during deploy tests" >&2
exit 1
EOF
chmod +x "$work_dir/bin/docker" "$work_dir/bin/curl"
export PATH="$work_dir/bin:$PATH"
export DOCKER_TEST_LOG="$work_dir/docker.log"
unset DEPLOY_ENV_FILE ENABLE_LOCAL_LLM ENABLED_MODELS LOCAL_LLM_MODE
cd "$work_dir/project"

fail() { echo "FAIL: $*" >&2; exit 1; }
set_value() {
  awk -v key="$1" -v value="$2" '
    index($0, key "=") == 1 { print key "=" value; next }
    { print }
  ' .env > .env.tmp
  mv .env.tmp .env
}
reset_env() {
  cp .env.example .env
  set_value DB_PASSWORD test-password-at-least-24-characters
  set_value JWT_SECRET test-secret-at-least-32-characters-long
  : > "$DOCKER_TEST_LOG"
}
assert_env() { grep -Fxq "$1" "${2:-.env}" || fail "missing $1 in ${2:-.env}"; }
assert_log() { grep -Fq -- "$1" "$DOCKER_TEST_LOG" || fail "missing Docker call: $1"; }
reject_log() { if grep -Fq -- "$1" "$DOCKER_TEST_LOG"; then fail "unexpected Docker call: $1"; fi; }

# Help and misspelled flags must not initialize .env or touch Docker.
: > "$DOCKER_TEST_LOG"
bash deploy.sh --help > "$work_dir/help.log"
[[ ! -e .env && ! -s "$DOCKER_TEST_LOG" ]] || fail "help had side effects"
if bash deploy.sh --local-ia > "$work_dir/error.log" 2>&1; then fail "unknown flag accepted"; fi
grep -Fq 'unknown argument: --local-ia' "$work_dir/error.log"
[[ ! -e .env && ! -s "$DOCKER_TEST_LOG" ]] || fail "unknown flag had side effects"

# The existing no-AI flow must keep working.
reset_env
bash deploy.sh > "$work_dir/no-ai.log" 2>&1
assert_env ENABLE_LOCAL_LLM=false
assert_env ENABLED_MODELS=
assert_log 'compose --env-file .env build'
assert_log --expect-no-ai
reject_log 'verify_local_inference'

# A flag cannot silently deploy no-AI when model configuration is missing.
reset_env
if bash deploy.sh --local-ai > "$work_dir/error.log" 2>&1; then fail "missing checksum accepted"; fi
grep -Fq 'LOCAL_LLM_MODEL_SHA256 is required' "$work_dir/error.log"
assert_env ENABLE_LOCAL_LLM=true
assert_env ENABLED_MODELS=local_llm
reject_log ' build'
reject_log ' up '

# Managed mode enables the profile, exports both switches, and probes inference.
reset_env
printf 'test model bytes\n' > models/model.gguf
model_sha=$(sha256sum models/model.gguf | awk '{print $1}')
set_value LOCAL_LLM_MODEL_SHA256 "$model_sha"
set_value ENABLED_MODELS deepseek
set_value DEEPSEEK_API_KEY test-key
mv .env custom.env
DEPLOY_ENV_FILE=custom.env ENABLE_LOCAL_LLM=false ENABLED_MODELS=gigachat \
  bash deploy.sh --local-ai > "$work_dir/managed.log" 2>&1
[[ ! -e .env ]] || fail "custom env changed default .env"
assert_env ENABLE_LOCAL_LLM=true custom.env
assert_env ENABLED_MODELS=deepseek,local_llm custom.env
assert_env DEEPSEEK_API_KEY=test-key custom.env
assert_log 'compose --env-file custom.env --profile local-ai build'
assert_log 'build-env: ENABLE_LOCAL_LLM=true ENABLED_MODELS=deepseek,local_llm'
assert_log 'verify_local_inference'
reject_log --expect-no-ai
reject_log 'rm -sf local-llm'

# Repeating the flag does not duplicate the model; plain deploy keeps it enabled.
DEPLOY_ENV_FILE=custom.env bash deploy.sh --local-ai > "$work_dir/repeat.log" 2>&1
assert_env ENABLED_MODELS=deepseek,local_llm custom.env
: > "$DOCKER_TEST_LOG"
DEPLOY_ENV_FILE=custom.env bash deploy.sh > "$work_dir/persisted.log" 2>&1
assert_log 'compose --env-file custom.env --profile local-ai build'
assert_log 'verify_local_inference'

# External mode is preserved and never starts the managed model service.
reset_env
set_value LOCAL_LLM_MODE external
set_value LOCAL_LLM_BASE_URL http://host.docker.internal:1234/v1
bash deploy.sh --local-ai > "$work_dir/external.log" 2>&1
assert_env LOCAL_LLM_MODE=external
assert_env ENABLED_MODELS=local_llm
assert_log 'compose --env-file .env build'
assert_log 'verify_local_inference'
reject_log 'compose --env-file .env --profile local-ai build'
reject_log --expect-no-ai

echo 'Deploy CLI regression tests passed (Docker and inference stubbed).'
