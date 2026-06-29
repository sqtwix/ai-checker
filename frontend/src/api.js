export const isOfflineMode =
  String(import.meta.env.VITE_OFFLINE_MODE || "").toLowerCase() === "true";

const OFFLINE_REPORTS_KEY = "educheck_offline_reports";
const OFFLINE_TASKS_KEY = "educheck_offline_tasks";

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Check if we are running in local Vite development mode
  if (window.location.port === "5173") {
    return "http://127.0.0.1:5000/api/v1";
  }
  // Fallback to relative path for production proxying
  return "/api/v1";
};

const API_BASE_URL = getApiBaseUrl();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const stripExtension = (fileName) => fileName.replace(/\.[^/.]+$/, "");

const normalizeOfflineReport = (report) => ({
  id: String(report.id),
  course: report.course || "Электронный курс",
  title: report.title || "Локальный демо-отчет",
  errors: Array.isArray(report.errors) ? report.errors : [],
  recommendations: Array.isArray(report.recommendations) ? report.recommendations : [],
  status: report.status || "Completed",
  error: report.error || "",
  isArchived: Boolean(report.isArchived),
  createdAt: report.createdAt || new Date().toISOString(),
  updatedAt: report.updatedAt || new Date().toISOString(),
  result: report.result || null,
});

const getOfflineReports = () => readJson(OFFLINE_REPORTS_KEY, []).map(normalizeOfflineReport);

const saveOfflineReports = (reports) => {
  writeJson(OFFLINE_REPORTS_KEY, reports.map(normalizeOfflineReport));
};

const getOfflineTasks = () => readJson(OFFLINE_TASKS_KEY, {});

const saveOfflineTasks = (tasks) => {
  writeJson(OFFLINE_TASKS_KEY, tasks);
};

const generateOfflineReport = ({ taskId, benchmarkFile, userResponseFiles, modelType }) => {
  const benchName = stripExtension(benchmarkFile.name);
  const firstResponseName = stripExtension(userResponseFiles[0]?.name || "Ответы студентов");
  const extraCount = Math.max(userResponseFiles.length - 1, 0);
  const course = `${benchName} & ${firstResponseName}${extraCount ? ` +${extraCount}` : ""}`;

  return normalizeOfflineReport({
    id: taskId,
    course,
    title: `Демо-анализ ${userResponseFiles.length} файла(ов) ответов через ${modelType}`,
    errors: [
      {
        priority: "high",
        val: "58%",
        question: `${firstResponseName}: Вопрос q_1`,
        text: "Группа часто выбирает один и тот же неверный вариант. В offline mode это шаблонная находка для проверки интерфейса.",
      },
      {
        priority: "medium",
        val: "34%",
        question: `${benchName}: Вопрос q_2`,
        text: "Часть ответов выглядит слишком похожей по структуре. Рекомендуется проверить формулировку задания и варианты ответов.",
      },
    ],
    recommendations: [
      "Добавить пояснение к вопросам с высокой долей ошибок.",
      "Проверить группы с одинаковыми паттернами ответов.",
      `Повторить анализ в online mode для реальной проверки моделью ${modelType}.`,
    ],
    result: {
      global_course_summary: `Демо-анализ ${userResponseFiles.length} файла(ов) ответов через ${modelType}`,
      test_summaries: [],
      student_detailed_analyses: [
        { student_id: "20251010006", test_name: "Демо", question_id: "q_1", ai_score_percent: 45, uniqueness_status: "Normal", error_explanation: "Демо-ошибка в offline-режиме." },
        { student_id: "20251010009", test_name: "Демо", question_id: "q_1", ai_score_percent: 65, uniqueness_status: "Normal", error_explanation: "Демо-ошибка в offline-режиме." }
      ],
      anomalies: [
        { student_id: "20251010006", anomaly_type: "SpeedCheating", severity: "High", description: "Демо-аномалия скорости в offline-режиме." }
      ]
    }
  });
};

const reportToApiResult = (report) => ({
  global_course_summary: report.title,
  test_summaries: [
    {
      test_name: report.course,
      critical_mass_errors: report.errors.map((error, index) => ({
        question_id: error.question || `q_${index + 1}`,
        fail_rate_percent: Number.parseFloat(error.val) || 0,
        error_pattern_description: error.text || "Описание ошибки не заполнено.",
        methodological_reason: "Offline mode: демо-данные для проверки интерфейса.",
      })),
    },
  ],
  course_recommendations: report.recommendations.map((recommendation, index) => ({
    priority: index === 0 ? "high" : "medium",
    target: report.course,
    action_item: recommendation,
  })),
});

export function seedOfflineReports(reports) {
  if (!isOfflineMode || localStorage.getItem(OFFLINE_REPORTS_KEY)) return;
  saveOfflineReports(reports);
}

export async function request(endpoint, options = {}) {
  const token = localStorage.getItem("token");

  const headers = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = "Произошла ошибка при выполнении запроса";
    try {
      const errData = await response.json();
      errorMsg = errData.error || errData.message || errorMsg;
    } catch {
      // JSON parsing failed, try plain text
      try {
        const text = await response.text();
        if (text) errorMsg = text;
      } catch {
        // ignore
      }
    }
    throw new Error(errorMsg);
  }

  // Handle empty responses (like 204 No Content)
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function login(email, password) {
  if (isOfflineMode) {
    await delay(250);
    if (!email || !password) throw new Error("Заполните email и пароль.");
    return {
      token: `offline-token-${Date.now()}`,
      username: email.split("@")[0] || "offline-user",
    };
  }

  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(username, email, password) {
  if (isOfflineMode) {
    await delay(250);
    if (!username || !email || !password) throw new Error("Заполните все поля.");
    return {
      token: `offline-token-${Date.now()}`,
      username,
    };
  }

  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
}

export async function uploadFiles(benchmarkFile, userResponseFiles, modelType) {
  if (isOfflineMode) {
    await delay(300);
    const taskId = `offline-${Date.now()}`;
    const report = generateOfflineReport({
      taskId,
      benchmarkFile,
      userResponseFiles,
      modelType,
    });
    const tasks = getOfflineTasks();
    tasks[taskId] = {
      id: taskId,
      status: "Processing",
      createdAt: Date.now(),
      report,
    };
    saveOfflineTasks(tasks);
    return {
      task_id: taskId,
      message: "Offline mode: файлы приняты в локальную обработку.",
    };
  }

  const formData = new FormData();
  formData.append("benchmarkFile", benchmarkFile);
  userResponseFiles.forEach((file) => {
    formData.append("userResponseFiles", file);
  });
  formData.append("modelType", modelType.toLowerCase());

  return request("/analysis/upload", {
    method: "POST",
    body: formData,
  });
}

export async function getAnalysisStatus(taskId) {
  if (isOfflineMode) {
    await delay(400);
    const tasks = getOfflineTasks();
    const task = tasks[taskId];
    if (!task) {
      return { status: "Failed", error: "Offline task not found" };
    }

    if (Date.now() - task.createdAt < 1600) {
      return { status: "Processing" };
    }

    task.status = "Completed";
    tasks[taskId] = task;
    saveOfflineTasks(tasks);

    const reports = getOfflineReports();
    if (!reports.some((report) => report.id === taskId)) {
      saveOfflineReports([task.report, ...reports]);
    }

    return {
      status: "Completed",
      result: reportToApiResult(task.report),
    };
  }

  return request(`/analysis/status/${taskId}`);
}

export async function getAnalysisHistory(options = {}) {
  const { includeArchived = false, onlyArchived = false } = options;

  if (isOfflineMode) {
    await delay(120);
    return getOfflineReports().filter((report) => {
      if (onlyArchived) return report.isArchived;
      if (!includeArchived) return !report.isArchived;
      return true;
    });
  }

  const params = new URLSearchParams();
  if (includeArchived) params.set("includeArchived", "true");
  if (onlyArchived) params.set("onlyArchived", "true");
  const query = params.toString();

  return request(`/analysis/history${query ? `?${query}` : ""}`);
}

export async function renameAnalysisReport(taskId, newName) {
  if (isOfflineMode) {
    await delay(120);
    const reports = getOfflineReports();
    const nextReports = reports.map((report) =>
      report.id === taskId
        ? normalizeOfflineReport({ ...report, course: newName, updatedAt: new Date().toISOString() })
        : report
    );
    saveOfflineReports(nextReports);
    return nextReports.find((report) => report.id === taskId) || null;
  }

  return request(`/analysis/rename/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ name: newName }),
  });
}

export async function createOfflineReport(report) {
  if (!isOfflineMode) throw new Error("Создание локального отчета доступно только в offline mode.");
  await delay(120);
  const nextReport = normalizeOfflineReport({
    id: `manual-${Date.now()}`,
    ...report,
  });
  saveOfflineReports([nextReport, ...getOfflineReports()]);
  return nextReport;
}

export async function updateOfflineReport(reportId, patch) {
  if (!isOfflineMode) throw new Error("Редактирование локального отчета доступно только в offline mode.");
  await delay(80);
  let updatedReport = null;
  const reports = getOfflineReports().map((report) => {
    if (report.id !== reportId) return report;
    updatedReport = normalizeOfflineReport({
      ...report,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    return updatedReport;
  });
  saveOfflineReports(reports);
  return updatedReport;
}

export async function archiveAnalysisReport(reportId) {
  if (isOfflineMode) {
    await delay(80);
    saveOfflineReports(getOfflineReports().map((report) =>
      report.id === reportId
        ? normalizeOfflineReport({ ...report, isArchived: true, updatedAt: new Date().toISOString() })
        : report
    ));
    return null;
  }

  return request(`/analysis/archive/${reportId}`, {
    method: "PUT",
  });
}

export async function unarchiveAnalysisReport(reportId) {
  if (isOfflineMode) {
    await delay(80);
    saveOfflineReports(getOfflineReports().map((report) =>
      report.id === reportId
        ? normalizeOfflineReport({ ...report, isArchived: false, updatedAt: new Date().toISOString() })
        : report
    ));
    return null;
  }

  return request(`/analysis/unarchive/${reportId}`, {
    method: "PUT",
  });
}

export async function getUserSettings() {
  if (isOfflineMode) return null;
  return request("/user/settings");
}

export async function saveUserSettings(settings) {
  if (isOfflineMode) return null;
  return request("/user/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
