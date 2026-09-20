# Production hardening audit

> Исторический документ прогона 15.09.2026. Независимая повторная приёмка
> 20.09.2026, текущие ограничения и найденные исправления зафиксированы в
> `CUSTOMER_ACCEPTANCE_HANDOFF_RU.md`; для решения о релизе используйте её вместе
> с `RELEASE_GATE.md`.

Дата фактического прогона: 15 сентября 2026 года.

## Проверенное окружение

- Docker Compose production stack: frontend, ASP.NET Core API, FastAPI AI Driver,
  PostgreSQL и managed llama.cpp.
- Штатный no-AI режим.
- External OpenAI-compatible local provider через отдельный test endpoint.
- CSV и XLSX из `doc/` и `example_data/`.

## Подтверждённые сценарии

- `deploy.sh`: генерация и повторное чтение `.env`, config validation, production
  image build, health wait, HTTP smoke.
- Чистая PostgreSQL БД создаётся EF Core baseline migration.
- Frontend/API/AI Driver/PostgreSQL переходят в `healthy`.
- Регистрация, JWT, настройки, proxy и история работают через публичный frontend.
- В no-AI режиме upload возвращает `503 MODEL_UNAVAILABLE` до создания записи.
- External endpoint прошёл `/models`, минимальный chat inference и полный
  трёхшаговый analysis pipeline.
- Managed Qwen2.5-Coder-3B GGUF прошёл холодную загрузку, deploy inference probe
  и полный пользовательский E2E через публичный frontend URL: регистрация двух
  пользователей, upload, `Queued → Processing → Completed`, отчёт, история,
  переименование, архивирование и восстановление.
- Массовый XLSX acceptance прошёл через публичный frontend URL и реальную managed
  модель: `Queued → Processing → Completed`, 5 вертикальных блоков, 64 попытки,
  1856 ответов/детальных строк, 1458 правильных (78,6%), 14 массовых ошибок,
  0 подтверждённых аномалий и 3 source-grounded рекомендации.
- Полный payload массового теста (416019 символов) был ограничен до 2206 символов
  и трёх распределённых по блокам примеров для AI. Модельный JSON, обрезанный
  output budget, был отклонён; задача без retry завершилась `degraded`, а все
  опубликованные числа и строки детерминированно восстановлены из полного входа.
- Excel parser теперь читает все worksheets и повторные вертикальные LMS-блоки.
  На 12 валидных реальных выгрузках подтверждены наборы до 6 тестов, 611 попыток
  и 34719 ответов. В группе 069 найден реальный отсутствующий в эталоне вопрос;
  отдельный E2E подтвердил понятный terminal `Failed` до вызова AI.
- E2E подтвердил ACL (чужая задача возвращает 404), восстановление исходных
  student id после HMAC-псевдонимизации и точные source-derived метрики: 3 из 6
  правильных ответов, 66,7% ошибок по проблемному вопросу, 6 детальных строк.
- Отчёт проверен визуально в desktop и mobile viewport. Исправлено перекрытие
  контента минимальной боковой панелью на ширине до 980 px. Через UI фактически
  сформированы PDF, Excel, CSV и JSON экспорты с успешными уведомлениями.
- Аварийно остановленная `Processing` задача после старта API перешла на вторую
  попытку и завершилась `Completed`; payload затем очищен.
- После отключения provider задача выполнила три разрешённые попытки, получила
  terminal `Failed`, payload и каталог файлов удалены.
- Проверен restart race после исчерпания attempts: cancellation больше не
  перезаписывает terminal-состояние в `Retrying`; startup перевёл специально
  оставленную невосстановимую задачу в `Failed` и удалил orphan job-каталог.
- API и браузерная валидация email синхронизированы: адрес с пробелом отклонён
  кодом 400 до создания пользователя.
- `pg_dump -Fc` восстановлен в изолированную временную БД; контрольные counts
  users/reports/completed совпали.
- После приёмки удалены только созданные тестами аккаунты `@example.test` и их
  каскадные отчёты (36 пользователей, 21 отчёт). Финальный backup/restore smoke
  чистой БД подтвердил `users/reports/completed = 0/0/0`; бизнес-данных в БД не
  было.
- API и AI Driver работают non-root/read-only; PostgreSQL и managed model не
  публикуются на host; Docker log rotation включена.
- Пятнадцать unit tests AI Driver, .NET build, frontend lint/build, CSV/XLSX parser
  smoke и все Compose-конфигурации прошли. `make verify` постоянно включает
  multi-sheet, повторные вертикальные блоки и отрицательный кейс отсутствующего
  эталонного вопроса.
- Dependency audit на момент прогона: npm — 0 известных уязвимостей, pip-audit —
  0 известных уязвимостей. NuGet build завершён; локальный advisory feed был
  временно недоступен и поэтому перепроверяется hosted CI.

## Что требует инфраструктуры заказчика

- Реальный runtime DeepSeek/GigaChat не запускался без выданных заказчиком
  ключей и бюджета.
- Нативный `deploy.ps1` проверен статически, но не запускался в Windows-среде.
- TLS/WAF, registry, secret store, off-host backup storage, retention,
  monitoring/alerting и production deploy target должны быть выбраны владельцем
  инфраструктуры.

Эти пункты намеренно остаются незакрытыми в `RELEASE_GATE.md`; их нельзя честно
заменить mock-проверкой или предположением.

## Сверка с похожим проектом

Из задачи `codex://threads/01a02b62-754e-7733-962d-7b363d37bf71` перенесены и
проверены применимые решения: единый deploy contract, безопасный идемпотентный
`.env`, штатный no-AI режим, managed/external local LLM, inference probe после
health, PostgreSQL queue с `SKIP LOCKED`, restart recovery, restore smoke,
privacy boundary и честный release gate. В отличие от исходного проекта здесь
также добавлен hosted CI workflow.

Дополнительно перенесены post-validation и bounded-context принципы: модель не
назначает числовые баллы вопреки LMS, большие входы получают явный
`quality_status=degraded`, а invalid JSON отдельной роли не повторяет всю задачу.
Transport timeout остаётся retryable. Для bounded course analysis рискованные
аномалии, сводка и рекомендации строятся только сервером по полному входу.

Не копировались механизмы, не соответствующие архитектуре: ASP.NET Data
Protection volume не нужен stateless JWT-only API, а checkpoint отдельных
профилей не подходит атомарному course-analysis контракту. При рестарте текущая
задача безопасно повторяет весь трёхшаговый AI pipeline в рамках ограниченного
числа попыток; частичный AI-ответ не публикуется как полностью проверенный.

Во время stress/restart серии установлено operational limitation managed
llama.cpp: после нескольких отмен длинных generation requests runtime может
оставаться формально healthy, но зависать до первого токена. Контролируемый
restart model container восстановил нормальную скорость; deploy/release build и
CPU inference на этом 8-core host нельзя выполнять одновременно.
