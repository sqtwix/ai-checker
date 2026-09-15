# Руководство разработчика

## Архитектура

- `frontend/` — React 19 + Vite, production-раздача через Nginx;
- `api-core/` — ASP.NET Core 9, JWT, PostgreSQL, загрузка/парсинг и история;
- `ai-driver/` — FastAPI и последовательный конвейер трёх агентов;
- `llama-cpp/` — опциональный локальный OpenAI-compatible inference server.

Production queue находится в PostgreSQL, а файлы незавершённых заданий — в
volume `analysis-jobs`. `FOR UPDATE SKIP LOCKED` допускает несколько worker без
двойной обработки. Схема изменяется только EF Core migrations.

Redis в runtime не используется и поэтому удалён из production Compose и
документации. Не заявляйте очередь Redis без её фактической реализации.

## Проверить всё одной командой

```bash
make verify
```

Требуются `.NET 9 SDK`, `Python 3.11+` и Docker Compose. При наличии Node.js
20+/npm frontend проверяется локально; иначе `make verify` использует его
production Docker build. Скрипт сам создаёт `ai-driver/.venv`, если её ещё нет.

## Локальный запуск компонентов

Сначала создайте `.env` и поднимите PostgreSQL/AI-driver. PostgreSQL production-
конфигурации не публикуется на host; dev override открывает его только на
`127.0.0.1`:

```bash
./scripts/init_env.sh
./scripts/compose.sh -f docker-compose.yml -f docker-compose.dev.yml \
  --env-file .env up -d postgres ai-driver
```

API:

```bash
cd api-core/ApiCore/ApiCore
ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aichecker;Username=aichecker;Password=YOUR_DEV_PASSWORD' \
JwtSettings__Secret='LOCAL_DEV_SECRET_AT_LEAST_32_CHARACTERS' \
AiDriver__Url='http://127.0.0.1:8000' \
dotnet run --urls http://127.0.0.1:5000
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

Vite работает на `http://127.0.0.1:5173` и обращается к API на `5000`.

AI-driver без Docker:

```bash
cd ai-driver
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Windows activation: `.venv\Scripts\activate`; команды запуска те же.

Frontend demo:

```bash
cd frontend
VITE_OFFLINE_MODE=true VITE_ENABLED_MODELS=deepseek npm run dev
```

## Контракты данных

api-core отправляет `course_name`, список tests/questions/student attempts и
nullable `time_spent_seconds`. Если LMS не экспортирует время, значение равно
`null`: запрещено подменять его синтетическими числами и строить обвинения на
несуществующей метрике.

AI pipeline:

1. `main-analyzer` — сравнение с эталоном и массовые ошибки;
2. `anomalies-analyzer` — аномалии только по доступным данным;
3. `statistics-summarizer` — итоговая сводка и рекомендации.

Перед отправкой в AI реальные student id заменяются task-scoped HMAC aliases;
в типизированном результате API восстанавливает исходные id. Свободный текст
ответов всё равно может содержать персональные данные, поэтому подключение
cloud/external provider требует утверждённого privacy agreement.

Ошибка/timeout провайдера возвращает 502. Опциональный не-ИИ fallback включается
только `ALLOW_PROGRAMMATIC_FALLBACK=true` и маркирует отчёт.

## Тесты и проверки

```bash
dotnet build api-core/ApiCore/ApiCore/ApiCore.csproj -c Release
dotnet run --project api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -- \
  'doc/Эталон ответов Python.csv' 'doc/Ответы студентов Python - Тест 1.csv'

cd ai-driver
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/pip check

cd ../frontend
npm ci
npm run lint
npm run build
```

После запуска стека:

```bash
ai-driver/.venv/bin/python scripts/smoke_stack.py
./scripts/backup_restore_smoke.sh
python3 scripts/analysis_e2e.py \
  --benchmark 'doc/Эталон ответов Python.csv' \
  --response 'doc/Ответы студентов Python - Тест 1.csv'
```

Последняя команда проходит публичный frontend URL: регистрацию двух
пользователей, ACL, загрузку, durable queue, реальный AI-анализ, проверку
метрик/русского текста/исходных идентификаторов, историю, переименование,
архивирование и восстановление. Она оставляет тестовые записи и предназначена
только для отдельной development/acceptance-БД.

Local provider использует canonical id `local_llm`; `qwen_local`, `qwen` и
`local` поддерживаются только как legacy aliases. Managed режим запускает
закреплённый llama.cpp и проверенный GGUF, external использует произвольный
утверждённый OpenAI-compatible `/v1`. Проверка `/models` выполняется до записи
задачи, а deploy требует также успешный chat completion.

Новая migration:

```bash
dotnet ef migrations add MeaningfulName \
  --project api-core/ApiCore/ApiCore/ApiCore.csproj \
  --output-dir Migrations
```

Не возвращайте `EnsureCreated` или ad-hoc DDL в startup. Первая baseline
migration специально идемпотентна, чтобы принять БД старых версий.

## Правила релиза

- Не коммитьте `.env`, модели, uploads, `node_modules`, `.venv`, `bin/obj` и pyc.
- Используйте UTF-8; BOM не требуется ни .NET SDK, ни Python/JS.
- Любое изменение входного формата сопровождайте новым ParserSmoke/test case.
- Перед передачей заказчику: `make verify`, dependency audit, image build,
  `./deploy.sh`, restore smoke и реальный тест каждого выбранного AI-провайдера.
- Hosted CI находится в `.github/workflows/ci.yml`; deploy job добавляется только
  после выбора registry, production target и secret store.
- Полный список ручных gates находится в `RELEASE_GATE.md`.
