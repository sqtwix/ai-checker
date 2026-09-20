# НейроЭксперт

Система анализа результатов тестирования: React-интерфейс, ASP.NET Core API,
Python AI-driver и PostgreSQL. Поддерживаются DeepSeek, GigaChat и локальная
OpenAI-совместимая модель через llama.cpp.

## Самый быстрый запуск

Требуются Docker Engine и Docker Compose v2 (`docker compose`) либо standalone
Compose (`docker-compose`).

```bash
./deploy.sh
```

Скрипт безопасно создаёт `.env`, генерирует DB/JWT secrets, проверяет
конфигурацию, собирает образы, ждёт healthchecks и выполняет smoke-тест. Без
настроенной модели платформа штатно запускается: история и настройки доступны,
а новый анализ отклоняется до постановки в очередь с `MODEL_UNAVAILABLE`.

Windows: `deploy.bat` или `powershell -File deploy.ps1`.

После перехода всех контейнеров в `healthy` откройте
[http://localhost:3000](http://localhost:3000).

```bash
make ps       # состояние
make logs     # логи
make down     # остановка
```

## Поддерживаемые сценарии

| Сценарий | Команда | Что требуется |
| --- | --- | --- |
| Без AI | `./deploy.sh` | ничего; секреты генерируются автоматически |
| Облачный AI | `./deploy.sh` | ключ provider и его id в `ENABLED_MODELS` |
| Managed local LLM | `./deploy.sh` | GGUF-каталог, SHA-256, `ENABLE_LOCAL_LLM=true`, `local_llm` |
| External local LLM | `./deploy.sh` | OpenAI-compatible `/v1`, model id, `LOCAL_LLM_MODE=external` |
| Только UI/demo | `make up-demo` | ничего, данные хранятся в браузере |
| Локальная разработка | см. `DEVELOPER_GUIDE.md` | Node.js, .NET 9, Python 3.11+ |

Demo-режим предназначен для показа интерфейса и не выполняет настоящий анализ.
Программный fallback AI-driver отключён по умолчанию: сбой провайдера виден как
ошибка, а не маскируется под результат ИИ.

## Адреса production Compose

- frontend: `http://localhost:3000`;
- публичный API: `http://localhost:3000/api/v1` через frontend proxy;
- health frontend: `http://localhost:3000/health`.

API, AI-driver, PostgreSQL и managed model доступны только внутри Docker-сети.
В dev override API и AI-driver публикуются на loopback. Для внешнего business-
доступа публикуйте frontend через внешний HTTPS reverse proxy.

## Проверка перед релизом

```bash
make verify
./deploy.sh
./scripts/backup_restore_smoke.sh
```

`make verify` проверяет обе Compose-конфигурации, собирает backend/frontend,
запускает тесты AI-driver и прогоняет реальные CSV/XLSX примеры через парсер.

На отдельной acceptance-БД полный пользовательский сценарий с реально
настроенной моделью проверяется так (скрипт создаёт тестовых пользователей и
отчёт, поэтому не запускайте его на рабочей БД):

```bash
python3 scripts/analysis_e2e.py \
  --benchmark 'doc/Эталон ответов Python.csv' \
  --response 'doc/Ответы студентов Python - Тест 1.csv'
```

## Документация

- [USER_GUIDE.md](USER_GUIDE.md) — работа преподавателя;
- [ADMIN_GUIDE.md](ADMIN_GUIDE.md) — production deployment и эксплуатация;
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) — локальная разработка и тесты.
- [RELEASE_GATE.md](RELEASE_GATE.md) — обязательный production release gate.
- [CUSTOMER_ACCEPTANCE_HANDOFF_RU.md](CUSTOMER_ACCEPTANCE_HANDOFF_RU.md) —
  независимая приёмка 20.09.2026, сценарий презентации и handoff заказчику.
- [PRODUCTION_HARDENING_AUDIT.md](PRODUCTION_HARDENING_AUDIT.md) — что реально
  проверялось в историческом hardening-прогоне 15.09.2026.

Авторы: Шульга Иван, Прокудин Александр, Валавеа Ирина, Бондарев Максим.
Контакт: `ivan20140767@gmail.com`.
