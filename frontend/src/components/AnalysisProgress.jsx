import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { elapsedTime } from "../reportPresentation";

const labels = {
  Uploading: "Отправка файлов",
  Queued: "Анализ в очереди",
  Processing: "Анализ выполняется",
  Retrying: "Ожидание повторной попытки",
  Cancelling: "Анализ останавливается",
};

export function AnalysisProgress({ createdAt, status = "Queued", check, isOfflineMode = false, onStop, stopping = false }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const uploading = status === "Uploading";
  const cancelling = status === "Cancelling" || stopping;
  const stale = Boolean(check?.checkedAt && now - check.checkedAt > 20000);
  const connectionProblem = check?.error || stale;
  const checkedTime = check?.checkedAt
    ? new Date(check.checkedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="panel analysis-status-panel" id="upload-progress-panel">
      <div className="analysis-status-layout">
        <div className="analysis-status-copy">
          <span className="badge" role="status">{labels[status] || "Ожидание результата"}</span>
          <h2>{uploading ? "Передаём файлы на сервер" : cancelling ? "Останавливаем анализ" : "Готовим ваш отчёт"}</h2>
          <p>{uploading
            ? "После проверки файлов анализ начнётся автоматически."
            : cancelling ? "Новые части больше не запускаются. Ожидаем завершения текущего запроса к модели; это может занять несколько минут. Автоматического повтора не будет."
            : status === "Retrying"
              ? "Сервер запланировал повторную попытку. Задание сохранено, повторная загрузка не нужна."
              : status === "Queued"
                ? "Файлы приняты. Задание ожидает обработки на сервере."
                : "Сервер обрабатывает ответы и формирует отчёт. Результат появится здесь после завершения."}</p>
          <div className="progress-track is-running" role="progressbar" aria-label="Выполнение анализа" aria-valuetext={labels[status]}><span /></div>
          <p className="muted">{isOfflineMode
            ? "В демонстрационном режиме создаётся пример отчёта."
            : "Большой набор на локальной модели может обрабатываться несколько часов. Готовые части сохраняются для продолжения после временного сбоя."} Можно перейти к другим отчётам: задание останется в истории.</p>
          {!uploading && <p className={`analysis-connection ${connectionProblem ? "connection-warning" : ""}`} role="status">
            {connectionProblem
              ? "Статус пока не удалось обновить. Анализ может продолжаться на сервере."
              : checkedTime ? "Статус получен от сервера." : "Ожидаем ответ сервера о состоянии задания."}
            {checkedTime && <span> Последняя проверка: {checkedTime}.</span>}
          </p>}
          {!uploading && onStop && <button type="button" className="secondary-button" onClick={onStop} disabled={cancelling}>
            {cancelling ? "Останавливается…" : "Остановить анализ"}
          </button>}
        </div>
        <aside className="analysis-timer" aria-label="Время ожидания анализа">
          <Clock3 size={24} aria-hidden="true" />
          <span>С момента отправки</span>
          <strong role="timer" aria-live="off">{elapsedTime(createdAt, now)}</strong>
          <p>Включая очередь. Это прошедшее время, а не обратный отсчёт.</p>
        </aside>
      </div>
    </div>
  );
}
