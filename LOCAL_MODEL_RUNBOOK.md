# Локальная Qwen для НейроЭксперта на порту 3000

Это адаптация команд из инструкции команды ИОТ к текущему проекту
`ai-checker`. Здесь используются собственные API и сценарий анализа ответов
студентов. Веб-интерфейс остаётся на http://localhost:3000/.

## Конфигурация

В существующем `.env` сохраните пароли БД/JWT и установите:

```env
FRONTEND_PORT=3000
ENABLED_MODELS=local_llm
ENABLE_LOCAL_LLM=true
LOCAL_LLM_MODE=managed
LOCAL_LLM_MODELS_DIR=./models
LOCAL_LLM_MODEL_FILE=Qwen3-1.7B-Q4_K_M.gguf
LOCAL_LLM_MODEL_URL=https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf
LOCAL_LLM_MODEL_SHA256=d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5
LOCAL_LLM_BASE_URL=
LOCAL_LLM_API_KEY=
LOCAL_LLM_MODEL=local-model
LOCAL_LLM_DISABLE_THINKING=true
LOCAL_LLM_CONTEXT_SIZE=8192
LOCAL_LLM_GPU_LAYERS=0
LOCAL_LLM_THREADS=4
LOCAL_LLM_BATCH_SIZE=512
LOCAL_LLM_PARALLEL=1
AI_PROVIDER_TIMEOUT_SECONDS=180
AI_PIPELINE_TIMEOUT_SECONDS=0
AI_MAX_INPUT_CHARS=4000
AI_MAX_OUTPUT_TOKENS=1000
```

Если используются облачные модели, сохраните их идентификаторы и добавьте
`local_llm` в `ENABLED_MODELS` через запятую. Для этой версии таймаут запроса
задаётся через `AI_PROVIDER_TIMEOUT_SECONDS`; переменные
`AI_REQUEST_TIMEOUT_SECONDS` и `AI_LOCAL_REQUEST_TIMEOUT_SECONDS` из исходной
инструкции не используются.

Для Qwen3 отключён thinking через `LOCAL_LLM_DISABLE_THINKING=true`:
короткий inference probe и JSON-ответы должны укладываться в лимит выходных
токенов. Параметр применяется к встроенному llama.cpp; пустое значение
сохраняет режим по умолчанию из шаблона модели.

## Запуск и обновление

Docker Desktop должен работать. Из корня проекта в Windows:

```cmd
deploy.bat
```

В macOS/Linux:

```bash
./deploy.sh --local-ai
```

Скрипт скачивает отсутствующую модель, проверяет SHA-256, пересобирает
интерфейс со списком моделей, запускает контейнеры и проверяет реальный
ответ Qwen. Уже скачанный GGUF используется повторно. Успешное завершение:

```text
Deployment complete: http://localhost:3000
```

После изменения `.env` повторите deploy: список моделей включается в сборку
frontend. Не удаляйте Docker volumes при обновлении.

## Проверка

```bash
docker compose --profile local-ai ps
docker compose exec -T api-core curl -fsS http://localhost:5000/health/ready
docker compose exec -T ai-driver python -c "import httpx; print(httpx.get('http://localhost:8000/models/availability').json())"
docker compose exec -T ai-driver python -c "from backend.model_availability import verify_local_inference; raise SystemExit(0 if verify_local_inference() else 1)"
```

Должны работать пять сервисов: `postgres`, `local-llm`, `ai-driver`,
`api-core`, `frontend`. В ответе availability ожидается
`local_llm.available: true`, а последняя команда должна завершиться с кодом 0.
Значение `model: local-model` — настроенный API-псевдоним GGUF-файла.

API и AI Driver в production доступны внутри Docker-сети. Порты 5050/8000
и поля `generation_available`, `status: ready` из инструкции ИОТ здесь
не используются для диагностики. Команды выше проверяют текущий API напрямую.

В браузере откройте http://localhost:3000/, обновите страницу и выберите
«Локальная модель».

Полная проверка в Windows (реальный анализ тестовых CSV, очередь, готовый отчёт,
проверка доступа и удаление созданных тестом пользователей/отчётов):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local_model_smoke.ps1
```

Скрипт использует Python из Docker; отдельная установка Python не требуется.
Проверка проходит только при `quality_status: verified` и пустом списке
ограничений. На CPU выполнение может занимать несколько минут; большие
файлы требуют существенно больше времени.

Локальный анализ обрабатывает весь набор частями в пределах
`AI_MAX_INPUT_CHARS`, без выборки и обрезания ответов. Полностью одинаковые
ответы на один вопрос с одинаковой LMS-оценкой анализируются один раз;
пояснение затем возвращается каждому студенту. Пропущенные или некорректные
пояснения повторно запрашиваются меньшими частями. Если восстановить их
не удалось, отчёт явно получает `degraded` с числом затронутых ответов.
Числовые показатели и допустимость аномалий проверяются по всему исходному
набору. Один ответ, превышающий лимит вместе с вопросом и эталоном, вызывает
ошибку; его текст не обрезается. Для него нужно увеличить входной лимит и
контекст модели. Старые сохранённые отчёты не пересчитываются автоматически:
запустите их анализ заново.

`AI_PIPELINE_TIMEOUT_SECONDS=0` отключает общий часовой обрыв. Таймаут одного
запроса к модели задаётся отдельно через `AI_PROVIDER_TIMEOUT_SECONDS`.
Проверенные части сохраняются в Docker-томе `analysis-checkpoints`: при
повторе той же задачи после временного сбоя готовые ответы читаются оттуда.
После перезапуска контейнеров том сохраняется; удаление тома удаляет прогресс.
Новая загрузка создаёт новую задачу. Локальная модель всё ещё может обрабатывать
большой набор несколько часов — отключение лимита не ускоряет генерацию.

В процентах учитываются только записи с распознаваемой оценкой LMS.
Пустые позиции без оценки исключаются; пустой текст с явной неверной оценкой
сохраняется как ошибка. Несовпадения эталонов двух файлов выводятся в отчёте.

Для проверки большого XLSX-набора сначала получите ожидаемые количества
штатным парсером (для этой команды нужен .NET SDK 9), затем передайте их
проверочному скрипту:

```powershell
dotnet build api-core/ApiCore/ParserSmoke/ParserSmoke.csproj -c Release
New-Item -ItemType Directory -Force models/verification | Out-Null
dotnet api-core/ApiCore/ParserSmoke/bin/Release/net9.0/ParserSmoke.dll --json `
  'example_data/001/Эталон ответов ЭК 001.xlsx' `
  'example_data/001/Массив ответов 001_группа 1.xlsx' |
  Set-Content -Encoding UTF8 models/verification/group1.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local_model_smoke.ps1 `
  -Benchmark 'example_data/001/Эталон ответов ЭК 001.xlsx' `
  -Response 'example_data/001/Массив ответов 001_группа 1.xlsx' `
  -ExpectedShape models/verification/group1.json
```

После исключения пустых позиций без оценки этот набор содержит 1 340 ответов,
259 вопросов и 10 студентов (62 попытки). Скрипт сверяет
полноту готового отчёта, показатели и отсутствие ограничений, проверяет права
доступа, затем удаляет только созданных им временных пользователей и отчёты.

## Перед демонстрацией

1. Откройте `http://localhost:3000/` и обновите страницу после обновления проекта.
   Если сессия завершилась, войдите повторно: сохранённые отчёты и выполняющиеся
   задачи остаются на сервере. Интерфейс теперь явно сообщает об ответе `401`.
2. Для короткого показа загрузите `doc/benchmark_python.csv` как эталон и
   `doc/responses_python.csv` как ответы, выберите «Локальная модель».
   Набор содержит 6 ответов трёх студентов. Измерьте время его обработки
   на компьютере для демонстрации при свободной очереди.
3. Для демонстрации большого набора заранее выполните анализ Excel.
   ЭК 001 / группа 1 содержит 1 340 учитываемых ответов. Время зависит от
   модели, настроек и CPU; прежние замеры до исправления пустых позиций
   неприменимы. Ожидание в интерфейсе больше не обрывается через 10 минут.
   Готовый результат доступен в истории после перезагрузки.
4. Проверены: вход и восстановление после истечения сессии, загрузка файлов,
   понятная ошибка пустого эталона в минимальном режиме, переименование,
   список студентов и фильтр, архивирование/восстановление, PDF/Excel/CSV/JSON.

Диагностика:

```bash
docker compose --profile local-ai logs --tail=100 local-llm ai-driver api-core
```
