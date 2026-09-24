export const SESSION_EXPIRED_EVENT = "educheck:session-expired";
export const SESSION_EXPIRED_MESSAGE = "Сессия завершилась. Войдите снова. Ваши отчёты и запущенные анализы сохранены.";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function expireSession(requestToken) {
  // A late response from an old session must not sign out a newly logged-in user.
  if (localStorage.getItem("token") !== requestToken) return;
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

function errorMessage(data, fallback) {
  if (typeof data === "string") return data.trim() || fallback;
  if (!data || typeof data !== "object") return fallback;
  for (const key of ["error", "detail", "message"]) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key];
  }
  if (data.errors && typeof data.errors === "object") {
    const messages = Object.values(data.errors).flat().filter((item) => typeof item === "string");
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

export async function requestJson(url, options = {}, { authenticated = true } = {}) {
  const token = localStorage.getItem("token");
  if (authenticated && !token) {
    expireSession(token);
    throw new ApiError(SESSION_EXPIRED_MESSAGE, 401);
  }
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError("Не удалось связаться с сервером. Проверьте подключение и повторите попытку.", 0);
  }

  if (response.status === 401 && authenticated) {
    expireSession(token);
    throw new ApiError(SESSION_EXPIRED_MESSAGE, 401);
  }
  const text = await response.text();
  let data = null;
  let validJson = false;
  if (text.trim()) {
    try { data = JSON.parse(text); validJson = true; }
    catch { data = text.trim().startsWith("<") ? null : text; }
  }
  if (!response.ok) {
    const messages = {
      401: "Неверный email или пароль.",
      403: "Недостаточно прав для этого действия.",
      413: "Размер файлов превышает допустимый. Уменьшите файлы и повторите загрузку.",
      429: "Слишком много запросов. Подождите немного и повторите попытку.",
      502: "Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.",
      503: "Сервис временно занят или недоступен. Попробуйте позже.",
      504: "Сервер не успел ответить. Проверьте историю анализов перед повторной отправкой.",
    };
    throw new ApiError(errorMessage(data, messages[response.status] || "Не удалось выполнить запрос. Повторите попытку."), response.status);
  }
  if (text.trim() && (!validJson || (data !== null && typeof data !== "object"))) {
    throw new ApiError("Сервер вернул некорректный ответ. Повторите попытку.", response.status);
  }
  return data;
}
