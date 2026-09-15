#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEMPLATE="$ROOT_DIR/.env.example"
ENV_FILE="${ENV_FILE_PATH:-$ROOT_DIR/.env}"
[[ "$ENV_FILE" = /* ]] || ENV_FILE="$ROOT_DIR/$ENV_FILE"

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    python3 -c "import secrets; print(secrets.token_hex($1))"
  fi
}

validate_env_file() {
  local file="$1"
  awk '
    /^[[:space:]]*($|#)/ { next }
    !/^[A-Za-z_][A-Za-z0-9_]*=/ { print "ERROR: invalid .env line " NR > "/dev/stderr"; bad=1; next }
    {
      key=$0; sub(/=.*/, "", key)
      if (seen[key]++) { print "ERROR: duplicate .env key: " key > "/dev/stderr"; bad=1 }
    }
    END { exit bad }
  ' "$file"
}

if [[ -f "$ENV_FILE" ]]; then
  validate_env_file "$ENV_FILE"
  if [[ -s "$ENV_FILE" && $(tail -c 1 "$ENV_FILE" | wc -l | tr -d ' ') -eq 0 ]]; then
    printf '\n' >> "$ENV_FILE"
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key="${line%%=*}"
    grep -q "^${key}=" "$ENV_FILE" || printf '%s\n' "$line" >> "$ENV_FILE"
  done < "$TEMPLATE"
else
  umask 077
  cp "$TEMPLATE" "$ENV_FILE"
fi

db_password=$(sed -n 's/^DB_PASSWORD=//p' "$ENV_FILE")
jwt_secret=$(sed -n 's/^JWT_SECRET=//p' "$ENV_FILE")
runtime_db_password=""
runtime_jwt_secret=""
if command -v docker >/dev/null 2>&1; then
  api_container=$(docker ps -a \
    --filter 'label=com.docker.compose.project=ai-checker' \
    --filter 'label=com.docker.compose.service=api-core' \
    --format '{{.ID}}' 2>/dev/null | head -n 1 || true)
  if [[ -n "$api_container" ]]; then
    runtime_env=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_container" 2>/dev/null || true)
    runtime_connection=$(printf '%s\n' "$runtime_env" | sed -n 's/^ConnectionStrings__DefaultConnection=//p' | head -n 1)
    runtime_jwt_secret=$(printf '%s\n' "$runtime_env" | sed -n 's/^JwtSettings__Secret=//p' | head -n 1)
    if [[ "$runtime_connection" == *Password=* ]]; then
      runtime_db_password=${runtime_connection##*Password=}
      runtime_db_password=${runtime_db_password%%;*}
    fi
  fi
fi
if [[ -z "$db_password" || "$db_password" == replace-* ]]; then
  db_password=${runtime_db_password:-$(random_hex 32)}
fi
if [[ ${#jwt_secret} -lt 32 || "$jwt_secret" == replace-* ]]; then
  if [[ ${#runtime_jwt_secret} -ge 32 ]]; then jwt_secret=$runtime_jwt_secret
  else jwt_secret=$(random_hex 48); fi
fi

env_dir=$(dirname "$ENV_FILE")
temporary=$(mktemp "$env_dir/.ai-checker-env.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT
awk -v db="$db_password" -v jwt="$jwt_secret" '
  /^DB_PASSWORD=/ { print "DB_PASSWORD=" db; next }
  /^JWT_SECRET=/ { print "JWT_SECRET=" jwt; next }
  { sub(/\r$/, ""); print }
' "$ENV_FILE" > "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$ENV_FILE"
trap - EXIT
validate_env_file "$ENV_FILE"
echo "Environment ready: $ENV_FILE (mode 600; secrets were not printed)."
