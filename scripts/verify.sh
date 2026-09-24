#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

echo "[1/7] Validate scripts and Compose configurations"
bash -n deploy.sh scripts/init_env.sh scripts/compose.sh scripts/verify.sh scripts/backup_restore_smoke.sh
bash scripts/tests/test_deploy.sh
./scripts/compose.sh --env-file .env.example config >/dev/null
./scripts/compose.sh --env-file .env.example --profile local-ai config >/dev/null
./scripts/compose.sh -f docker-compose.offline.yml --env-file .env.example config >/dev/null
./scripts/compose.sh -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.example config >/dev/null

echo "[2/7] Build api-core"
dotnet build api-core/ApiCore/ApiCore/ApiCore.csproj -c Release
test -f api-core/ApiCore/ApiCore/Migrations/AppDbContextModelSnapshot.cs
if rg -n 'Database\.EnsureCreated' api-core/ApiCore/ApiCore --glob '*.cs'; then
  echo "ERROR: EnsureCreated is forbidden; add an EF Core migration." >&2
  exit 1
fi

echo "[3/7] Exercise CSV and XLSX parsers"
dotnet build api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release
dotnet run --project api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release --no-build -- --self-test
dotnet run --project api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release --no-build -- \
  "doc/Эталон ответов Python.csv" "doc/Ответы студентов Python - Тест 1.csv"
dotnet run --project api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release --no-build -- \
  "example_data/001/Эталон ответов ЭК 001.xlsx" \
  "example_data/001/Массив ответов 001_группа 1.xlsx"
vertical_blocks_output=$(dotnet run --project api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release --no-build -- \
  "example_data/005/005_Эталоны ответов.xlsx" \
  "example_data/005/005_Массив ответов.xlsx")
echo "$vertical_blocks_output"
if [[ "$vertical_blocks_output" != *"OK: 5 tests"* ]]; then
  echo "ERROR: repeated vertical LMS blocks were not parsed independently" >&2
  exit 1
fi
if invalid_source_output=$(dotnet run --project api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release --no-build -- \
  "example_data/069/Эталон ответов 069.xlsx" \
  "example_data/069/Массив ответов 069_группа 3.xlsx" 2>&1); then
  echo "ERROR: a response question missing from the benchmark was accepted" >&2
  exit 1
fi
if [[ "$invalid_source_output" != *"Что включает в себя понятие"* ]]; then
  echo "ERROR: invalid source rejection did not identify the unmatched question" >&2
  exit 1
fi

echo "[4/7] Test ai-driver"
if [[ ! -x ai-driver/.venv/bin/python ]]; then
  python3 -m venv ai-driver/.venv
  ai-driver/.venv/bin/pip install -r ai-driver/requirements.txt
fi
(
  cd ai-driver
  .venv/bin/python -m compileall -q .
  .venv/bin/python -m unittest discover -s tests -v
  .venv/bin/pip check
)
python3 -m py_compile scripts/*.py

echo "[5/7] Lint and build frontend"
if command -v npm >/dev/null 2>&1; then
  (
    cd frontend
    npm ci
    npm run lint
    npm test
    npm run build
  )
else
  echo "npm is not installed on the host; verifying frontend via its production Docker build"
  ./scripts/compose.sh --env-file .env.example build frontend
fi

echo "[6/7] Verify tracked files contain no generated caches or secrets"
while IFS= read -r file; do
  if [[ -e "$file" ]]; then
    echo "ERROR: Generated file is tracked by Git: $file" >&2
    exit 1
  fi
done < <(git ls-files | grep -E '(^|/)(__pycache__|node_modules|bin|obj|dist)/|\.py[co]$|^\.env$' || true)

echo "[7/7] Check patch formatting"
git diff --check

echo "All verification checks passed."
