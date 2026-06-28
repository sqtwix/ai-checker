# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Запуск без backend

Frontend умеет работать в offline/demo-режиме без backend. В этом режиме авторизация, история отчетов, создание и редактирование отчетов работают локально через `localStorage`.

Для запуска dev-сервера:

```bash
VITE_OFFLINE_MODE=true npm run dev
```

После запуска откройте адрес, который покажет Vite, обычно `http://127.0.0.1:5173`.

Для production-сборки offline-режим тоже нужно включать на этапе сборки:

```bash
VITE_OFFLINE_MODE=true npm run build
```

Важно: переменные `VITE_*` встраиваются Vite во время build. Если используется Docker, передавайте `VITE_OFFLINE_MODE=true` как build arg/environment до сборки frontend-образа.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
