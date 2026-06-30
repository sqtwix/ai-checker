# Руководство администратора — НейроЭксперт

Данное руководство содержит информацию по установке, конфигурированию ИИ-провайдеров, администрированию баз данных и оптимизации локального сервера инференса.

---

## 1. Системные требования и Сетевая структура

Система разворачивается в изолированной Docker-сети `saas-network`. 

### Сетевая конфигурация портов (Host -> Container):
* **3000 -> 80** — frontend (Nginx раздает статическую сборку React).
* **5000 -> 8080** — api-core (ядро .NET Core Web API).
* **5432 -> 5432** — postgres (СУБД PostgreSQL).
* **6379 -> 6379** — redis (Брокер очередей и кэш).
* **8000 -> 8000** — ai-driver (Python FastAPI сервис агентов).
* **8001 -> 8080** — qwen-local (llama.cpp сервер).

---

## 2. Настройка переменных окружения

Конфигурация системы осуществляется через файл `.env` (пример env находиться в env_example.txt) в корне проекта или через секцию `environment` в `docker-compose.yml`.

### А. Настройки Базы Данных и Redis (api-core):
* `ConnectionStrings__DefaultConnection` — строка подключения к PostgreSQL. По умолчанию:
  `Host=postgres;Port=5432;Database=aichecker;Username=postgres;Password=postgres`
* `Redis__ConnectionString` — адрес Redis хоста. По умолчанию: `redis:6379`
* `JwtSettings__Secret` — секретный ключ для генерации JWT токенов (необходимо сменить в продакшене!).
* `JwtSettings__Issuer`, `JwtSettings__Audience` — параметры валидации токенов.

### Б. Настройки ИИ-провайдеров (ai-driver):
Для подключения внешних (облачных) моделей укажите ключи в соответствующих переменных:

#### 1. DeepSeek:
* `DEEPSEEK_API_KEY` — ваш API ключ от платформы DeepSeek.
* `DEEPSEEK_BASE_URL` — базовый адрес API (по умолчанию `https://api.deepseek.com`).
* `DEEPSEEK_MODEL` — используемая модель (по умолчанию `deepseek-chat`).

#### 2. Sber GigaChat (SberGPT):
* `SBERGPT_API_KEY` — API-ключ/авторизационный токен GigaChat.
* `SBERGPT_BASE_URL` — адрес API (по умолчанию `https://gigachat.devices.sberbank.ru/api/v1/`).
* `SBERGPT_MODEL` — используемая модель (по умолчанию `GigaChat-Pro`).

---

## 3. Администрирование локального сервера инференса (llama.cpp)

Локальная модель запускается в контейнере `qwen-local` на базе llama.cpp.

### Шаги для смены или добавления модели:
1. Скачайте модель в формате `.gguf` (рекомендуется `Qwen/Qwen3.5-0.8B-Instruct-GGUF` или `Qwen/Qwen3.5-3B-Instruct-GGUF` для баланса скорости и качества).
```shell
curl -LO https://huggingface.co/mozilla-ai/llamafile_0.10/resolve/main/Qwen3.5-0.8B-Q8_0.llamafile

# Make it executable (macOS/Linux/BSD)
chmod +x Qwen3.5-0.8B-Q8_0.llamafile
```
2. Поместите файл в папку `models/` в корне проекта.
3. Создайте переменные среды: скопируйте содержимое __env_example.txt__ (там уже есть перемнные для JWT) и создайте __.env файл__, добавив значения перемнных БД.
4. В файле `docker-compose.yml` в секции сервиса `qwen-local` обновите переменную окружения `MODEL_PATH`:
   ```yaml
   environment:
     - MODEL_PATH=/models/ИМЯ_ВАШЕГО_ФАЙЛА.gguf
   ```
5. Перезапустите контейнер: `docker compose up -d qwen-local`

### Настройка производительности на CPU:
В `docker-compose.yml` для сервиса `qwen-local` можно настроить следующие переменные:
* `N_THREADS` — количество физических ядер CPU, выделяемых для расчетов (рекомендуется выставлять равным числу физических ядер процессора хоста минус 1-2).
* `N_CTX` — размер контекстного окна в токенах (по умолчанию `8192`). Не рекомендуется занижать менее `4096`, так как JSON-данные тестов могут быть объемными.
* `BATCH_SIZE` — размер пакета для вычисления промпта (по умолчанию `512`).

---

## 4. Резервное копирование и Персистентность данных

Данные PostgreSQL сохраняются на хост-системе через Docker Volume `db-data`, который монтируется в `/var/lib/postgresql/data` контейнера `postgres`.

### Создание резервной копии базы данных (Дамп):
Выполните команду на хост-системе для создания SQL-дампа:
```bash
docker exec -t aichecker-postgres pg_dumpall -U postgres > backup_db.sql
```

### Восстановление базы данных из дампа:
```bash
cat backup_db.sql | docker exec -i aichecker-postgres psql -U postgres
```

---

## 5. Мониторинг работоспособности (Healthchecks)

Контейнеры снабжены встроенными проверками здоровья:
* **postgres**: проверяет готовность принимать соединения через `pg_isready`.
* **qwen-local**: опрашивает локальный эндпоинт `/health` сервера llama.cpp.
* Сервис `ai-driver` запускается только после успешного прохождения проверки здоровья `qwen-local` и `redis` (задано через `depends_on -> condition: service_healthy`).
* В случае зависания локального сервера инференса, Docker автоматически перезапустит контейнер благодаря политике `restart: unless-stopped`.
