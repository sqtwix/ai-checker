# Руководство разработчика — AI-Checker

Данное руководство содержит описание структуры кодовой базы проекта, логику работы мультиагентного конвейера, правила кодирования и инструкции по локальной разработке.

---

## 1. Структура проекта

Репозиторий состоит из трех основных подпроектов:

```text
ai-checker/
├── api-core/             # Бэкенд на ASP.NET Core 9.0
│   ├── ApiCore/
│   │   ├── Controllers/  # Эндпоинты (AnalysisController, AuthController, UserController)
│   │   ├── Data/         # Контекст EF Core (AppDbContext.cs)
│   │   ├── Models/       # Сущности БД и DTO (AnalysisReport.cs, CourseBatchAnalysisResult.cs)
│   │   └── Services/     # Бизнес-логика (FileParser, ValidationService, ReportsService, AnalysisService)
│   └── ApiCore.sln
│
├── frontend/             # Фронтенд на React + Vite
│   ├── src/
│   │   ├── components/   # UI-компоненты (Pages.jsx, AccessibilityToolbar.jsx, Layout.jsx)
│   │   ├── App.jsx       # Точка входа приложения и роутинг сценариев загрузки
│   │   └── api.js        # API-клиент (интеграция с бэкендом api-core)
│   └── package.json
│
├── ai-driver/            # Сервис управления ИИ-агентами на Python + FastAPI
│   ├── backend/          # Логика агентов (agent_manager.py, agent_factory.py, agent_client.py)
│   ├── controllers/      # Контроллеры обработки запросов (agent_controller.py)
│   ├── schemas/          # Схемы запросов и ответов Pydantic (analysis_request.py, analysis_response.py)
│   ├── system_prompts.json # Системные промпты для специализаций ИИ-агентов
│   ├── main.py           # Точка входа uvicorn
│   └── routes.py         # Эндпоинты API
│
└── llama-cpp/            # Сборка локального сервера llama.cpp
```

---

## 2. Логика ИИ-конвейера (последовательный пайплайн)

Обработка запроса в `ai-driver` реализует последовательный конвейер из трех специализированных ИИ-агентов (согласно ТЗ):

1. **main-analyzer** (`Step 1`) — принимает исходные данные тестов и ответов студентов. Сравнивает ответы студентов с эталонами, оценивает их семантическое соответствие и выделяет критические паттерны массовых ошибок (где доля неверных ответов $\ge 40\%$).
2. **anomalies-analyzer** (`Step 2`) — принимает исходные данные и результаты первого шага. Фокусируется на анализе времени прохождения тестов и оценок для поиска аномалий:
   * **SpeedCheating**: быстрые ответы + высокий балл.
   * **ExtremeStruggling**: медленные ответы + низкий балл.
   * **SuspiciousMatch**: аномальное сходство ответов.
3. **statistics-summarizer** (`Step 3`) — агрегирует выводы предыдущих шагов, генерирует общий методический вывод по успеваемости и формирует приоритетный список рекомендаций по оптимизации материалов курса.

### Программная постобработка (Enrichment Step)
Для исключения потери студентов с 100% правильных ответов (которых ИИ-агенты пропускают из-за отсутствия ошибок) в [agent_controller.py](file:///c:/Users/ivan2/ai-checker/ai-driver/controllers/agent_controller.py) внедрен метод `_enrich_and_complete_response`. Он сканирует исходный запрос и автоматически добавляет пропущенных студентов и их правильные ответы в результирующую структуру `student_detailed_analyses` с оценкой `100.0`.

---

## 3. Кодировка файлов и BOM (Важно!)

Для стабильной работы компилятора .NET (MSBuild) на системах Windows с отличными от UTF-8 кодовыми страницами (например, CP1251 на русскоязычных ОС) действует строгое правило:
> **Все файлы исходного кода (C#, JS, JSX, Python), содержащие кириллические символы, должны быть сохранены в формате UTF-8 с BOM (Byte Order Mark, сигнатура `\xef\xbb\xbf`).**

Для автоматического приведения кодировок файлов в соответствие с этим правилом в корне проекта доступен скрипт:
```bash
python C:\Users\ivan2\.gemini\antigravity-ide\brain\<conversation-id>\scratch\fix_encodings.py
```

---

## 4. Локальный запуск для разработки

Вы можете запускать сервисы локально на хост-машине вне контейнеров для отладки.

### А. Запуск бэкенда (api-core)
Требуется установленный .NET 9.0 SDK и запущенные PostgreSQL и Redis (можно использовать из Docker Compose).
```bash
cd api-core/ApiCore/ApiCore
dotnet run
```
*Эндпоинт по умолчанию: `http://localhost:5000`*

### Б. Запуск фронтенда (frontend)
Требуется Node.js 18+.
```bash
cd frontend
npm install
npm run dev
```
*Адрес локального dev-сервера: `http://localhost:5173`*

### В. Запуск ИИ-драйвера (ai-driver)
Требуется Python 3.10+.
```bash
cd ai-driver
python -m venv .venv
source .venv/bin/activate # или .venv\Scripts\activate на Windows
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
*Эндпоинт по умолчанию: `http://localhost:8000`*
