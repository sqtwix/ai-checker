FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь остальной код (включая main.py) в рабочую директорию
COPY . .

# Открываем порт 8000, на котором будет работать FastAPI
EXPOSE 8000

# Команда для запуска сервера внутри контейнера.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]