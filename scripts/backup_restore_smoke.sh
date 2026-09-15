#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"
COMPOSE=(./scripts/compose.sh --env-file .env)
suffix="$(date +%Y%m%d%H%M%S)_$$"
database="ai_checker_restore_smoke_$suffix"
temporary=$(mktemp -d)
dump="$temporary/postgres.dump"

cleanup() {
  "${COMPOSE[@]}" exec -T postgres sh -lc 'dropdb --if-exists -U "$POSTGRES_USER" "$1"' sh "$database" >/dev/null 2>&1 || true
  rm -rf "$temporary"
}
trap cleanup EXIT

"${COMPOSE[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$dump"
[[ -s "$dump" ]] || { echo "ERROR: backup is empty" >&2; exit 1; }

source_counts=$("${COMPOSE[@]}" exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT (SELECT COUNT(*) FROM users) || '\''|'\'' || (SELECT COUNT(*) FROM analysis_reports) || '\''|'\'' || (SELECT COUNT(*) FROM analysis_reports WHERE result_json IS NOT NULL);"' | tr -d '\r')
"${COMPOSE[@]}" exec -T postgres sh -lc 'createdb -U "$POSTGRES_USER" "$1"' sh "$database"
"${COMPOSE[@]}" exec -T postgres sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-privileges' sh "$database" < "$dump"
restored_counts=$("${COMPOSE[@]}" exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$1" -Atc "SELECT (SELECT COUNT(*) FROM users) || '\''|'\'' || (SELECT COUNT(*) FROM analysis_reports) || '\''|'\'' || (SELECT COUNT(*) FROM analysis_reports WHERE result_json IS NOT NULL);"' sh "$database" | tr -d '\r')

[[ "$source_counts" == "$restored_counts" ]] || {
  echo "ERROR: restored counts differ: source=$source_counts restored=$restored_counts" >&2
  exit 1
}
echo "Backup/restore smoke passed: users|reports|completed=$restored_counts"
