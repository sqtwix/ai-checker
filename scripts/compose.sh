#!/usr/bin/env bash
set -euo pipefail

if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi

if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi

echo "ERROR: Docker Compose is not installed." >&2
exit 1
