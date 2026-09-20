# Production release gate

Релиз разрешён только когда каждый обязательный пункт подтверждён текущим
прогоном. Непроверенный внешний provider нельзя считать работающим по наличию
ключа или успешному `/health`.

## Автоматические проверки

- [ ] CI завершён успешно на release commit.
- [ ] `make verify` завершён успешно.
- [ ] `./deploy.sh` прошёл config validation, build, health wait и stack smoke.
- [ ] `scripts/backup_restore_smoke.sh` подтвердил восстановимость актуальной БД.
- [ ] Нет незакоммиченных файлов, секретов, `.env`, GGUF и runtime caches.
- [ ] Production images помечены неизменяемым release tag/digest.

## Runtime-сценарии

- [ ] Регистрация, вход, настройки, загрузка, очередь, отчёт, архив и экспорт.
- [ ] Ненастроенная модель возвращает `MODEL_UNAVAILABLE` до создания задачи.
- [ ] Перезапуск API во время анализа сохраняет задачу и автоматически продолжает её.
- [ ] Ошибка provider проходит ограниченные retries и завершается понятным статусом.
- [ ] Для каждой включённой облачной модели выполнен реальный тестовый анализ.
- [ ] Для local LLM выполнен deploy inference probe и тестовый анализ.
- [ ] Массовый XLSX-прогон проверил все листы/вертикальные блоки, bounded context
      и явный `quality_status`; несовпадающий с эталоном вопрос отклоняется до AI.
- [ ] Проверены ACL: один пользователь не видит отчёты и задачи другого.

## Эксплуатация

- [ ] Настроены TLS reverse proxy, firewall и доступ администраторов.
- [ ] Backup шифруется, отправляется off-host, имеет retention и мониторинг ошибок.
- [ ] Утверждены лимиты файлов, очереди, retries, RAM/CPU и дисковая квота.
- [ ] Настроены сбор логов, алерты health/disk/backup и ответственный дежурный.
- [ ] Зафиксирован rollback tag; проверена совместимость миграций с rollback.
- [ ] Заказчику переданы `ADMIN_GUIDE.md` и `USER_GUIDE.md` без секретов.

Hosted deployment намеренно не выполняется CI автоматически: production target,
registry и secret store должны быть утверждены владельцем инфраструктуры. После
их выбора отдельный gated deploy job должен использовать те же release images и
не собирать код повторно на сервере.

## Независимый acceptance-прогон 20 сентября 2026

С нуля подтверждены `make verify`, clean no-AI production deploy, внешний
OpenAI-compatible transport/contract, CSV/XLSX/ZIP, ACL, restart/retry/terminal
failure, atomic backpressure, malformed JSON fail-safe, backup/restore, четыре
формата экспорта и desktop/mobile UI. Точная матрица, цифры, исправления и
сценарий передачи заказчику находятся в `CUSTOMER_ACCEPTANCE_HANDOFF_RU.md`.

В этом независимом прогоне не было GGUF-файла и облачных ключей, поэтому managed
inference и реальные DeepSeek/GigaChat остаются внешними gates независимо от
исторических прогонов. Также открыты hosted CI на финальном commit, immutable
registry digest, Windows runtime, TLS/firewall, secret store, off-host backup,
monitoring/on-call и утверждённый rollback tag. До их закрытия это проверенный
release candidate, но не разрешение выкатывать его в production заказчика.
