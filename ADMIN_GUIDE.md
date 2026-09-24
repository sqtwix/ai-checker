# Руководство администратора

## 1. Подготовка

Минимум: Docker Engine и Docker Compose v2/standalone Compose. Для локальной
модели заранее оцените RAM/VRAM по требованиям конкретного GGUF-файла.

```bash
./scripts/init_env.sh
```

Перед первым запуском:

1. Скрипт сам генерирует уникальные `DB_PASSWORD` и `JWT_SECRET` и выставляет
   права `.env` `600`; существующие значения не заменяются.
2. Задайте ключи облачных провайдеров, которые реально будут использоваться.
3. Укажите только настроенные модели в `ENABLED_MODELS`, например
   `deepseek,gigachat,local_llm`.
4. Не включайте `ALLOW_PROGRAMMATIC_FALLBACK` без бизнес-решения: такой отчёт
   является простым расчётом, а не результатом ИИ, и явно маркируется в UI.

`.env` запрещён к коммиту. Не используйте значения-заглушки из `.env.example`
в production.

Если `.env` случайно удалён, но API-контейнер остался, initializer восстанавливает
DB/JWT credentials из его environment вместо генерации несовместимых новых
значений. Это аварийная страховка, а не замена secret manager и backup.

## 2. Запуск

Единственная рекомендуемая production-точка входа:

```bash
./deploy.sh
# Windows: deploy.bat
```

Скрипт валидирует env и Compose до сборки, ждёт health всех сервисов, выполняет
model inference probe для local LLM и общий HTTP smoke. Прямой `docker compose
up` оставлен для диагностики и разработки.
Smoke использует только зарезервированные адреса `smoke-*@example.test` и удаляет
технического пользователя вместе с его данными сразу после проверки.

Холодная загрузка managed GGUF с host-mounted каталога может занимать несколько
минут. Deployment ждёт её до 15 минут и только затем запускает inference probe.
Для медленных CPU значения `AI_PROVIDER_TIMEOUT_SECONDS`,
`AI_PIPELINE_TIMEOUT_SECONDS`, `AI_MAX_INPUT_CHARS` и `AI_MAX_OUTPUT_TOKENS`
задают бюджет одного AI-вызова, всей цепочки, входного контекста и ответа.
Локальный анализ делит весь набор на части до `AI_MAX_INPUT_CHARS` символов
(по умолчанию 4000), проверяет наличие пояснения для каждого ответа и использует
`AI_MAX_OUTPUT_TOKENS` без скрытых лимитов по ролям. Одинаковые ответы на один
вопрос с одинаковой LMS-оценкой обрабатываются вместе. Невалидные ответы модели
повторно запрашиваются меньшими частями; оставшиеся пропуски явно маркируются
как `degraded`. Полные числовые показатели всегда рассчитываются сервером по
всему исходному набору. Внутренние retries SDK отключены: сетевые сбои повторяет
наблюдаемая durable queue PostgreSQL. Для больших локальных наборов установите
`AI_PIPELINE_TIMEOUT_SECONDS=0` (без общего ограничения времени); длительность зависит от количества разных
ответов и скорости CPU. Настройки Qwen3 на порту 3000 приведены в
[LOCAL_MODEL_RUNBOOK.md](LOCAL_MODEL_RUNBOOK.md).
`LOCAL_LLM_THREADS=8` — проверенный baseline для Qwen2.5-Coder-3B на данном
8-core host; на сервере заказчика значение следует подобрать по CPU benchmark.

Managed GGUF:

1. Поместите совместимый instruct/chat GGUF для llama.cpp в `./models` либо
   укажите его каталог в `LOCAL_LLM_MODELS_DIR` (абсолютный путь допустим).
2. Укажите `LOCAL_LLM_MODEL_FILE`, обязательный `LOCAL_LLM_MODEL_SHA256`,
   `ENABLE_LOCAL_LLM=true`, `LOCAL_LLM_MODE=managed` и добавьте `local_llm` в
   `ENABLED_MODELS`.
3. Можно вместо ручного копирования указать HTTPS `LOCAL_LLM_MODEL_URL`:
   загрузка идёт через `.part`, проверяется SHA-256 и только затем публикуется.
4. Запустите `./deploy.sh --local-ai`. Флаг сохраняет `ENABLE_LOCAL_LLM=true` и
   добавляет `local_llm` в `ENABLED_MODELS`, сохраняя остальные провайдеры.
   Последующие запуски `./deploy.sh` используют сохранённую конфигурацию.

Каталог монтируется в контейнер только для чтения; GGUF не нужно и не следует
копировать в Git-репозиторий. Пример для отдельного каталога моделей:

```env
LOCAL_LLM_MODELS_DIR=/opt/ai-checker/models
LOCAL_LLM_MODEL_FILE=model.gguf
LOCAL_LLM_MODEL_SHA256=<64 hex characters>
```

Для уже имеющегося доверенного файла SHA-256 можно получить командой
`sha256sum ./models/model.gguf` (Windows: `Get-FileHash ./models/model.gguf -Algorithm SHA256`).
При загрузке по URL используйте контрольную сумму от издателя модели.

Если интерфейс показывает «AI-провайдер не настроен», проверьте
`ENABLED_MODELS`: список в UI задаётся при сборке frontend. После изменения
`.env` нужен повторный deploy с пересборкой, одного перезапуска контейнера
недостаточно. Наличие модели в списке само по себе не подтверждает готовность:
для managed режима нужен работающий `local-llm` с GGUF, а deploy проверяет
реальный ответ модели через inference probe.

Поддерживается любой instruct/chat GGUF, совместимый с закреплённым llama.cpp;
совместимость со всеми моделями не обещается.

External OpenAI-compatible endpoint:

```env
ENABLE_LOCAL_LLM=true
LOCAL_LLM_MODE=external
LOCAL_LLM_BASE_URL=http://host.docker.internal:1234/v1
LOCAL_LLM_MODEL=my-chat-model
LOCAL_LLM_API_KEY=
ENABLED_MODELS=local_llm
```

В контейнере `localhost` означает AI Driver, поэтому для runtime на Docker host
используйте `host.docker.internal`. Endpoint обязан поддерживать `/v1/models` и
`/v1/chat/completions`.

Demo UI без backend:

```bash
./scripts/compose.sh -f docker-compose.offline.yml --env-file .env up --build -d
```

## 3. Сеть и healthchecks

| Сервис | Host → container | Публичность по умолчанию |
| --- | --- | --- |
| frontend | `3000 → 80` | все интерфейсы |
| api-core | `5000` | только внутренняя Docker-сеть |
| ai-driver | `8000` | только внутренняя Docker-сеть |
| PostgreSQL | `5432` | только внутренняя Docker-сеть |
| local-llm | `8080` | только внутренняя Docker-сеть, профиль `local-ai` |

Проверка:

```bash
curl -fsS http://localhost:3000/health
./scripts/compose.sh --env-file .env ps
./scripts/compose.sh --env-file .env exec -T api-core curl -fsS http://localhost:5000/health/ready
./scripts/compose.sh --env-file .env exec -T ai-driver python -c \
  "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()"
```

`healthy` AI-driver означает готовность HTTP-сервиса, но не проверяет внешний
аккаунт/баланс облачного провайдера. Local LLM дополнительно проходит реальный
chat inference при каждом штатном deploy. Облачный provider перед релизом
проверяется тестовым анализом.

## 4. Защита и ограничения

- frontend добавляет базовые security headers и ограничивает запрос 100 МБ;
- API ограничивает каждый файл 50 МБ, до 50 response-файлов и очередь до 20 задач;
- ZIP ограничен суммарно на запрос 200 записями и 200 МБ распакованных данных;
- parser ограничен 100 листами, 200 000 строками, 10 000 столбцами и
  2 000 000 ячеек на файл;
- загружаемые имена не используются как пути;
- внутренние ошибки провайдера не возвращаются пользователю;
- идентификаторы студентов псевдонимизируются перед отправкой модели и
  восстанавливаются в сохранённом результате;
- frontend, API и AI Driver работают non-root с read-only root filesystem;
- Docker logs ограничены ротацией `10 МБ × 5`;
- Swagger API включён только в Development.

Изменить лимиты можно через `MAX_*` и `ANALYSIS_QUEUE_CAPACITY` в `.env`.
TLS завершается внешним reverse proxy/load balancer. Сохраняйте его конфигурацию
и сертификаты вне репозитория.

## 5. Обновление и rollback

```bash
git pull
./scripts/backup_restore_smoke.sh
./deploy.sh
```

До обновления сделайте backup. Для rollback checkout проверенного тега и
пересоберите образы; volume PostgreSQL не удаляйте.

## 6. Backup PostgreSQL

```bash
./scripts/compose.sh --env-file .env exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup-$(date +%F).sql
```

Восстановление в пустую/подготовленную БД:

```bash
./scripts/compose.sh --env-file .env exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup-2026-01-01.sql
```

Проверка реального dump/restore в изолированную временную БД:

```bash
./scripts/backup_restore_smoke.sh
```

Production backup должен быть зашифрован, храниться off-host, иметь retention и
мониторинг. Репозиторий намеренно не угадывает выбранное заказчиком хранилище.

## 7. Очередь и восстановление

Очередь хранится в PostgreSQL. Payload и загруженные файлы находятся в БД и
persistent volume `analysis-jobs`; worker берёт задачи через `FOR UPDATE SKIP
LOCKED`. После аварийного рестарта `Processing` переходит в `Retrying`, а
обработка продолжается. Временные ошибки provider повторяются до
`ANALYSIS_MAX_ATTEMPTS`, после чего задача получает terminal `Failed`, payload и
файлы удаляются. UI не рисует выдуманный прогресс, а отображает серверные
`Queued`/`Retrying`/`Processing`.

Схема управляется EF Core migration `ProductionBaseline`, которая также безопасно
принимает legacy БД ранних версий. Перед rollback проверяйте обратную
совместимость схемы и никогда не выполняйте `down -v` на production.

## 8. Наблюдаемость и perimeter

API выдаёт/валидирует `X-Correlation-ID`, прокидывает его в AI Driver и пишет
status/elapsed time в структурированные логи. Встроенных Prometheus,
OpenTelemetry и alert manager пока нет: на сервере заказчика необходимо
настроить сбор Docker logs и алерты health, disk и backup. Публичный frontend
нужно размещать за TLS reverse proxy/WAF; Compose сам публикует HTTP.
