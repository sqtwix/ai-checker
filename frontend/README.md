# Frontend

## Development

```bash
npm ci
npm run dev
```

По умолчанию Vite доступен на `http://127.0.0.1:5173`, API — на
`http://127.0.0.1:5000/api/v1`.

Доступные модели задаются при сборке:

```bash
VITE_ENABLED_MODELS=deepseek,gigachat,local_llm npm run build
```

Demo без backend:

```bash
VITE_OFFLINE_MODE=true npm run dev
```

Это демонстрационный режим с localStorage и шаблонными результатами, не AI-анализ.

## Checks

```bash
npm run lint
npm run build
```

Production Docker image использует `npm ci`, Nginx SPA fallback, `/api/` proxy,
upload/timeouts, security headers и `/health`.

Пустой `VITE_ENABLED_MODELS` является штатным no-AI режимом: интерфейс истории
и настроек доступен, запуск нового анализа заблокирован с объяснением.
