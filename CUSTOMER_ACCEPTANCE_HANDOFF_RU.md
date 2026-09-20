# НейроЭксперт: production-приёмка, демонстрация и технический handoff

Дата независимого прогона: 20 сентября 2026 года. Базовый commit проверки:
`68e48ab`. Документ описывает состояние рабочей копии после исправлений,
внесённых во время приёмки. Это release candidate, а не разрешение на выкладку
в инфраструктуру заказчика: внешние gates перечислены в конце.

## 1. Executive summary для заказчика

НейроЭксперт принимает выгрузки тестирования из LMS, детерминированно связывает
ответы с эталоном, рассчитывает проверяемые показатели и использует LLM только
для качественной интерпретации. Числовая истина остаётся у LMS и серверного
кода: модель не может повысить балл, придумать массовую ошибку, подменить число
попыток или опубликовать неподтверждённую аномалию.

Подтверждено локально на чистых PostgreSQL volumes:

- production Compose в режиме без AI и с внешним OpenAI-compatible endpoint;
- миграция чистой БД, health/readiness, повторный deploy, restart recovery;
- регистрация, вход, настройки, CSV/XLSX/ZIP, ACL, история, rename,
  archive/restore и четыре формата экспорта;
- 17 unit-тестов AI Driver, parser smoke, .NET build, frontend lint/build;
- CSV: 3 студента, 2 вопроса, 6 детальных строк, `verified`;
- повторные XLSX-блоки: 5 тестов, 145 вопросов, 64 попытки, 1856 ответов,
  `degraded` из-за bounded LLM context, но полные числа сохранены;
- parser dataset до 5 тестов, 259 вопросов, 62 попыток и 3024 ответов;
- malformed model JSON завершился `Completed/degraded`, без выдуманных данных;
- потеря provider дала `Retrying`, затем `Failed` после 3 попыток с очисткой
  payload и файлов;
- restart в `Processing` дал повторную попытку и `Completed`; в БД подтверждены
  `attempt_count=2` и очищенный payload;
- backpressure при capacity 2: 2 из 6 одновременных загрузок приняты, 4 получили
  503. До исправления все 6 ошибочно принимались;
- `pg_dump -Fc`/`pg_restore`: совпали `20 users / 15 reports / 13 completed`;
- npm, pip и NuGet audit: 0 известных уязвимостей по актуальным feeds.

Не подтверждены без внешней инфраструктуры: реальные DeepSeek/GigaChat,
inference managed GGUF, Windows runtime, TLS/WAF, registry, secret manager,
off-host backup, monitoring/alerting и rollback на утверждённом release tag.

## 2. Сценарий живой презентации

### С чего начать

1. Откройте production UI по HTTPS-адресу заказчика и скажите: «Система не
   заменяет LMS и преподавателя. Она сокращает время поиска массовых проблем и
   оставляет каждую цифру проверяемой по исходной выгрузке».
2. Войдите под заранее созданным демонстрационным методистом. Не используйте
   реальные персональные данные студентов на публичной демонстрации.
3. Откройте готовый отчёт, чтобы показать ценность за первые 30–60 секунд:
   сводку, массовую ошибку, детальные строки, статус качества и рекомендации.

### Основной walkthrough, 8–12 минут

1. **Новый анализ.** Покажите отдельный эталон и один или несколько файлов
   ответов. Объясните поддержку CSV, XLS, XLSX, ZIP, всех листов и повторных
   вертикальных LMS-блоков.
2. **Выбор модели.** Покажите только реально настроенные модели. Скажите, что
   модель влияет на формулировки, но не на LMS-баллы и агрегаты.
3. **Очередь.** Запустите анализ и покажите реальные состояния `Queued`,
   `Processing`, при временном сбое — `Retrying`. Задача сохраняется в
   PostgreSQL и переживает restart API.
4. **Отчёт.** Сначала покажите `quality_status`:
   - `verified` — модельный ответ прошёл структурную и серверную проверку;
   - `degraded` — числа восстановлены из исходных данных, но качественную часть
     нужно читать с указанными ограничениями;
   - `Failed` — результат не публикуется как успешный.
5. **Доказуемые показатели.** Сопоставьте число попыток, ответов, правильных
   ответов и процент массовой ошибки с исходной выгрузкой.
6. **Аномалии.** Объясните, что это сигнал для ручной проверки, не обвинение.
   SpeedCheating/ExtremeStruggling разрешены только при реальном времени в
   источнике и прохождении серверных порогов; SuspiciousMatch — только при
   подтверждённом повторе конкретного неверного ответа.
7. **Работа методиста.** Покажите поиск в истории, переименование, архив и
   восстановление.
8. **Передача результата.** Сформируйте PDF, Excel, CSV и JSON. В acceptance UI
   каждый формат дал успешное уведомление.
9. **Мобильный вид.** Покажите ширину 390 px: drawer, карточки в одну колонку,
   отсутствие горизонтального overflow (`scrollWidth=390`).
10. Завершите тезисом: «ИИ ускоряет интерпретацию, а система технически не даёт
    ему стать источником числовой истины».

### Что не следует говорить

- «Нейросеть всегда права» или «точность 100%»;
- «аномалия доказывает списывание»;
- «облачный provider проверен», если не был выполнен реальный платный запрос;
- «degraded равен verified»;
- «backup настроен», если проверен только локальный restore smoke без off-host
  хранения и retention.

## 3. Бизнес-ценность и пользователи

Целевые пользователи: методисты, преподаватели, руководители образовательных
программ, команды качества и администраторы платформы.

Основные business flows:

- методист загружает очередную выгрузку и за минуты получает карту массовых
  ошибок вместо ручного просмотра тысяч ячеек;
- преподаватель находит темы и вопросы, требующие повторного объяснения;
- руководитель сравнивает стабильные source-derived показатели между запусками;
- служба качества получает экспортируемый артефакт и ограничения анализа;
- администратор контролирует провайдеры, capacity, retries, backup и health.

Ожидаемый эффект нужно измерять пилотом: время подготовки отчёта, доля найденных
и подтверждённых методистом массовых ошибок, доля `degraded/Failed`, latency,
стоимость одного анализа и число ручных исправлений рекомендации.

## 4. Архитектура и pipeline

Компоненты:

- React/Vite UI, production-раздача через non-root Nginx;
- ASP.NET Core 9 API: JWT, ACL, upload, parser, очередь и история;
- PostgreSQL 15: пользователи, отчёты и durable state очереди;
- FastAPI AI Driver: три последовательные роли и post-validation;
- optional llama.cpp или внешний OpenAI-compatible `/v1` endpoint.

Поток данных:

```text
Пользователь
    │ HTTPS
    ▼
Frontend/Nginx ── /api/v1 ──► ASP.NET Core API
                                  │
                  upload limits ──┤──► persistent job volume
                  JWT + ACL       │
                                  ▼
                             PostgreSQL queue
                                  │ SKIP LOCKED
                                  ▼
                         parser + benchmark match
                                  │ HMAC student aliases
                                  ▼
                            FastAPI AI Driver
                      bounded context / 3 AI roles
                                  │
                                  ▼
                     deterministic post-validation
                                  │
                                  ▼
                PostgreSQL result + quality_status + limits
```

Очередь использует `FOR UPDATE SKIP LOCKED`. Admission capacity теперь
атомарен: финальные `COUNT + INSERT` сериализуются PostgreSQL-транзакцией.
`Processing` с сохранённым payload при старте переводится в `Retrying`.
Временные 429/5xx/network/timeout повторяются до `ANALYSIS_MAX_ATTEMPTS`.
Невалидные исходные данные завершаются terminal `Failed` без бессмысленного
повтора.

## 5. Почему текущая модель и какие альтернативы

Архитектура намеренно не привязана к одному вендору. Канонические варианты:

- **DeepSeek** — облачный OpenAI-подобный chat provider; подходит, когда
  разрешена передача данных и важны качество/скорость без собственной GPU;
- **GigaChat** — вариант для организаций с соответствующим договором и
  требованиями к провайдеру;
- **managed local LLM через llama.cpp** — данные не покидают контур, но нужны
  RAM/VRAM, подобранный GGUF и эксплуатация inference;
- **external OpenAI-compatible** — корпоративный vLLM, LM Studio, Ollama-
  совместимый gateway или иной утверждённый `/v1` endpoint.

Репозиторий не доказывает, что одна модель «лучшая». Выбор делается пилотом на
обезличенном наборе заказчика по качеству объяснений, latency, стоимости,
проценту валидного JSON и `degraded`, требованиям privacy и доступному железу.
Проверенный здесь external endpoint доказывает transport/contract/fail-safe, но
не качество конкретной коммерческой модели.

## 6. Системные гарантии качества AI

- Полные LMS-данные парсятся сервером до вызова модели.
- Student ID заменяются task-scoped HMAC aliases; исходные ID восстанавливаются
  только после типизированного ответа.
- Контекст модели ограничен `AI_MAX_INPUT_CHARS`; на большом наборе выбираются
  распределённые примеры, а не весь payload.
- Правильность и `ai_score_percent` принудительно равны LMS-истине: 100 или 0.
- Массовые ошибки, проценты, сводка и рекомендации пересобираются сервером по
  полному входу.
- Uniqueness и timing anomalies публикуются только при детерминированном
  подтверждении, а не по утверждению модели.
- Malformed JSON отдельной роли не перезапускает дорогой pipeline и переводит
  результат в `degraded` с ограничением.
- Transport failure не маскируется: по умолчанию это retry/Failed. Программный
  fallback выключен; если включён бизнес-решением, он маркируется
  `generation_mode=fallback`, `quality_status=degraded`.

Остаётся человеческий gate: даже `verified` означает проверенную структуру и
source-grounded показатели, а не истинность каждого качественного объяснения.

## 7. Безопасность и приватность

Подтверждённые меры:

- JWT с issuer/audience/lifetime/signature, нулевой clock skew, пароли через
  ASP.NET PasswordHasher; auth rate limit 20/min/IP;
- ACL по `user_id`; чужие status/rename/archive/unarchive возвращают 404;
- API и AI Driver не публикуются на host в production; публичен только frontend;
- frontend, API и AI Driver — non-root, read-only root filesystem,
  `no-new-privileges`; PostgreSQL/model не публикуются;
- CSP, `nosniff`, frame/referrer/permissions headers; Swagger только Development;
- безопасные server-generated upload paths; имя клиента не становится путём;
- ZIP: не более 200 записей и 200 МБ распакованных поддерживаемых файлов на весь
  запрос; unsupported entries не извлекаются; traversal-имя прошло E2E;
- parser: максимум 100 непустых листов, 200 000 строк, 10 000 столбцов и
  2 000 000 ячеек;
- request 100 МБ, один файл 50 МБ, до 50 исходных response-файлов; малые
  body-limits на auth/settings/rename;
- correlation ID валидируется, provider internals не выдаются клиенту, Docker
  logs ротируются `10 МБ × 5`;
- tracked secrets/GGUF/.env не обнаружены; `.env` имеет mode 600.

Privacy boundary: идентификаторы псевдонимизируются, но свободный текст ответа
может содержать ФИО, email или иные персональные сведения. Cloud/external LLM
можно включать только после DPA/privacy review, классификации данных, правил
retention и проверки региона обработки. Логи и exports также считаются
чувствительными.

Открытые security/operations gates: TLS/WAF, secret manager и rotation, SSO/MFA
при необходимости, централизованный audit log, image/SBOM scan в registry,
network policy, off-host encrypted backup, retention/deletion policy,
monitoring/alerts и incident runbook.

## 8. Развёртывание и эксплуатация

Production Unix:

```bash
./deploy.sh
make ps
```

Windows contract: `deploy.bat`/`deploy.ps1`; проверен статически, но нативный
Windows runtime в этой приёмке отсутствовал.

Режимы:

- no-AI: пустой `ENABLED_MODELS`; upload отклоняется 503 до создания задачи;
- managed: GGUF + SHA-256, `ENABLE_LOCAL_LLM=true`, `LOCAL_LLM_MODE=managed`;
- external: `LOCAL_LLM_BASE_URL`, model id, `LOCAL_LLM_MODE=external`;
- offline demo: `docker-compose.offline.yml`, данные только в browser storage;
- dev: production compose + `docker-compose.dev.yml`, который публикует API,
  AI Driver и PostgreSQL только на loopback.

Перед upgrade: backup, restore smoke, release notes миграций, immutable images.
Baseline migration имеет намеренно non-destructive `Down`; это не гарантирует
совместимость старого приложения с новой схемой. Rollback надо репетировать на
копии данных и фиксировать парой app tag + DB compatibility decision.

Если `.env` потерян, initializer может восстановить DB/JWT secrets только пока
сохранился API-контейнер с прежним environment. В приёмке сценарий с уже
существующим volume и новым несовместимым паролем корректно остановил API. Это
не замена secret manager: потерянный пароль восстанавливают из утверждённого
хранилища, а не генерируют поверх существующей БД.

## 9. Матрица фактических проверок

| Проверка | Факт 20.09.2026 |
| --- | --- |
| `make verify` | PASS; 17 AI tests, .NET/parser, frontend lint/build, Compose config |
| Clean no-AI production deploy | PASS; 4 healthy services, migrations, stack smoke |
| External OpenAI-compatible deploy | PASS; `/models`, chat probe, stack smoke |
| CSV E2E | PASS; 3 students, 2 questions, 6 details, `verified` |
| XLSX repeated blocks | PASS; 5 tests, 145 questions, 64 attempts, 1856 details, `degraded` |
| Другой XLSX parser sample | PASS; 5 tests, 259 questions, 62 attempts, 3024 answers |
| Missing benchmark question | PASS; `Queued → Failed`, понятный вопрос в error |
| ZIP + traversal-like name | PASS; Completed, 6 details, путь не использован |
| Auth/settings validation | PASS; whitespace name, bad email, short/long password, JSON limits |
| ACL | PASS; status/rename/archive/unarchive другого пользователя = 404 |
| Rename/archive/restore/history | PASS |
| Malformed model JSON | PASS; `Completed`, `degraded`, 6 source-derived details |
| Provider loss | PASS; `Processing → Retrying → Failed`, 3 attempts, cleanup |
| API restart | PASS; Completed, attempt 2, payload cleared |
| Backpressure | PASS после fix; capacity 2, accepted 2 / rejected 4 из 6 |
| Backup/restore | PASS; `20 / 15 / 13` counts совпали |
| Desktop UI | PASS, 1280 px visual check |
| Mobile UI | PASS, 390×844, no horizontal overflow |
| Exports | PASS UI notifications: PDF, Excel, CSV, JSON |
| Offline demo | PASS build/health/registration/demo history |
| Dependency audit | npm 0, pip 0, NuGet 0 known vulnerabilities |

Примечание: первая mobile screenshot была снята во время reload transition и
выглядела выцветшей; повторный стабильный кадр и DOM/computed-style проверка не
подтвердили overlay-дефект.

## 10. Найдено и исправлено в ходе приёмки

1. Race queue admission: capacity 2 принимал 6/6 concurrent uploads. Добавлен
   атомарный PostgreSQL admission; регрессия теперь даёт 2/6 + четыре 503.
2. Модель могла пометить `SuspiciousMatch` и timing anomaly без прохождения
   source-derived порогов. Все такие признаки теперь пересчитываются сервером;
   добавлены негативные unit tests.
3. Production напрямую публиковал unauthenticated AI Driver на host. API и AI
   Driver оставлены только во внутренней сети; loopback publishing перенесён в
   dev override.
4. Frontend работал с root master. Nginx переведён на user `nginx`, 8080,
   read-only root и `/tmp` runtime paths.
5. Несколько ZIP могли обходить per-archive limits. Счётчики сделаны общими на
   запрос, добавлен предел всех archive entries.
6. У parser не было явных limits на распакованные workbook dimensions. Добавлены
   пределы листов/строк/столбцов/ячеек.
7. Nginx 100 МБ, Kestrel default и deploy range расходились. Лимит синхронизирован
   и добавлены endpoint body limits.
8. Добавлены validation для password max, username после trim, settings object/
   size и report name max.
9. CI расширен repeated-block и unmatched-question parser cases, Python script
   compile и `git diff --check`.
10. Добавлены воспроизводимые `runtime_acceptance.py`,
    `backpressure_acceptance.py` и `--expect-failure` для E2E.

## 11. Честный release checklist

Локально закрыто:

- [x] build/lint/unit/parser/Compose config;
- [x] clean DB migration и повторный deploy;
- [x] no-AI и external provider contract;
- [x] основной API/UI lifecycle, ACL, exports, mobile;
- [x] restart/retry/backpressure/malformed JSON;
- [x] backup/restore smoke;
- [x] npm/pip/NuGet advisories.

Обязательно закрыть перед production:

- [ ] hosted CI на финальном commit;
- [ ] review/merge текущего diff и immutable release tag;
- [ ] registry images по digest + image/SBOM scan;
- [ ] реальный анализ каждой включаемой DeepSeek/GigaChat модели с ключом и
  бюджетом заказчика;
- [ ] managed GGUF inference + бизнес-E2E на целевом CPU/GPU, если режим нужен;
- [ ] Windows deploy на Windows host, если он входит в support matrix;
- [ ] TLS hostname, certificates, WAF/firewall/network policy;
- [ ] secret manager, rotation и документированный recovery `.env`;
- [ ] зашифрованный off-host backup, retention, restore drill и RPO/RTO;
- [ ] централизованные logs/metrics/alerts: readiness, queue depth/age, failures,
  provider latency, disk, backup;
- [ ] privacy/DPA, сроки хранения uploads/reports/exports и процесс удаления;
- [ ] утверждённый capacity/CPU/RAM/disk budget и нагрузочный тест целевого host;
- [ ] rollback tag и репетиция app/DB совместимости;
- [ ] ответственные за on-call, provider budget и incident response.

## 12. План интеграции в бизнес

1. **Неделя 1 — контур и владельцы.** Назначить product owner, администратора,
   privacy/security owner; выбрать provider, deployment target, SSO и backup.
2. **Неделя 1–2 — пилотный датасет.** Обезличить 5–10 типичных курсов, включая
   большие и некорректные выгрузки; зафиксировать ручной baseline методистов.
3. **Неделя 2 — инфраструктура.** Registry/digest, TLS, secrets, logging,
   encrypted backup, dashboards и alerts.
4. **Неделя 2–3 — model evaluation.** Сравнить 2–3 модели на одном наборе;
   утвердить rubric качественных объяснений, latency/cost и допустимую долю
   `degraded`.
5. **Неделя 3 — UAT.** Методисты проходят сценарии из раздела 2; все найденные
   расхождения оформляются как acceptance cases.
6. **Неделя 4 — ограниченный rollout.** 1–2 курса, ручное подтверждение каждой
   рекомендации, ежедневный review Failed/degraded и затрат.
7. **После пилота — go/no-go.** Решение по KPI, privacy, эксплуатации и TCO;
   только затем масштабирование и автоматизация импорта из LMS.

Команды воспроизведения находятся в `README.md`, `ADMIN_GUIDE.md`,
`DEVELOPER_GUIDE.md` и `RELEASE_GATE.md`. Этот документ является сценарием
демонстрации и handoff, но не заменяет эксплуатационные процедуры заказчика.
