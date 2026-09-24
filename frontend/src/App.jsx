import { useState, useEffect, useRef } from "react";
import { Archive, Files, Pencil, Save, Upload, XCircle } from "lucide-react";
import {
  login,
  register,
  uploadFiles,
  getAnalysisStatus,
  cancelAnalysis,
  getAnalysisHistory,
  renameAnalysisReport,
  isOfflineMode,
  enabledModels,
  seedOfflineReports,
  createOfflineReport,
  updateOfflineReport,
  archiveAnalysisReport,
  unarchiveAnalysisReport,
} from "./api";
import { AppLayout } from "./components/Layout";
import { AccessibilityToolbar } from "./components/AccessibilityToolbar";
import { ConfirmDialog, NamingDialog, ToastStack } from "./components/Feedback";
import { AuthPage, SettingsPage, StudentsPage } from "./components/Pages";
import { loadUserSettings, persistUserSettings, readLocalSettings } from "./settingsService";
import { getSidebarMaxWidth, layoutLimits, readLayoutPreferences, writeLayoutPreferences } from "./layoutPreferences";
import { SESSION_EXPIRED_EVENT, SESSION_EXPIRED_MESSAGE } from "./httpClient";
import { watchAnalysis } from "./analysisPolling";
import { ReportFindings, ReportRecommendations } from "./components/ReportFindings";
import { AnalysisProgress } from "./components/AnalysisProgress";

const navigateTo = (route) => {
  window.location.hash = route;
};

const createToastId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Initial Mock Reports Data representing ChatGPT-like dialog history
function generateMockResult(reportId) {
  if (reportId === "1") {
    const student_detailed_analyses = [];
    const anomalies = [];
    
    // Student 20251010006: 14 answers, avg 38, 4 low scores
    for (let i = 0; i < 14; i++) {
      student_detailed_analyses.push({
        student_id: "20251010006",
        test_name: "Тест 1",
        question_id: `q_1_${i+1}`,
        ai_score_percent: i < 4 ? 30 : 41,
        uniqueness_status: i === 0 ? "SuspiciousMatch" : "Normal",
        error_explanation: i === 0 ? "Синтаксис полностью совпадает с работой другого студента." : "Небольшое отклонение от эталонного синтаксиса."
      });
    }
    anomalies.push({
      student_id: "20251010006",
      anomaly_type: "SpeedCheating",
      severity: "High",
      description: "Аномально быстрое прохождение при высоком проценте совпадений с эталоном. Есть признаки списывания и повторения структуры правильных ответов."
    });

    // Student 20251010009: 15 answers, avg 70, 2 low scores
    for (let i = 0; i < 15; i++) {
      student_detailed_analyses.push({
        student_id: "20251010009",
        test_name: "Тест 1",
        question_id: `q_1_${i+1}`,
        ai_score_percent: i < 2 ? 40 : 75,
        uniqueness_status: "Normal",
        error_explanation: "Несколько ответов отличаются от эталона."
      });
    }

    // Student 20250801007: 14 answers, avg 91, 1 low score
    for (let i = 0; i < 14; i++) {
      student_detailed_analyses.push({
        student_id: "20250801007",
        test_name: "Тест 1",
        question_id: `q_1_${i+1}`,
        ai_score_percent: i === 0 ? 45 : 95,
        uniqueness_status: "Normal",
        error_explanation: "Результаты стабильны, аномалий по времени и паттернам ответов нет."
      });
    }

    return {
      global_course_summary: "Выявлены аномалии в промежуточных тестах и синтаксисе",
      test_summaries: [
        {
          test_name: "Тест 1",
          critical_mass_errors: [
            { question_id: "q_1_1", fail_rate_percent: 65, error_pattern_description: "Студенты массово выбирают неверный вариант с приставкой. Вероятная причина: путаница между звонкими и глухими согласными.", methodological_reason: "Добавить короткую справку по правописанию приставок." }
          ]
        }
      ],
      student_detailed_analyses,
      anomalies,
      course_recommendations: [
        { target: "Тест 1", action_item: "Добавить короткую справку по правописанию приставок.", priority: "High" }
      ]
    };
  }

  if (reportId === "2") {
    const student_detailed_analyses = [];
    const anomalies = [];

    // Student 20251010006: 14 answers, avg 45, 3 low scores
    for (let i = 0; i < 14; i++) {
      student_detailed_analyses.push({
        student_id: "20251010006",
        test_name: "Тест 2",
        question_id: `q_2_${i+1}`,
        ai_score_percent: i < 3 ? 35 : 48,
        uniqueness_status: "Normal",
        error_explanation: "Ошибки повторяются в заданиях одного типа."
      });
    }
    anomalies.push({
      student_id: "20251010006",
      anomaly_type: "ExtremeStruggling",
      severity: "Medium",
      description: "Ошибки повторяются в заданиях одного типа."
    });

    // Student 20251010009: 16 answers, avg 66, 2 low scores
    for (let i = 0; i < 16; i++) {
      student_detailed_analyses.push({
        student_id: "20251010009",
        test_name: "Тест 2",
        question_id: `q_2_${i+1}`,
        ai_score_percent: i < 2 ? 45 : 69,
        uniqueness_status: "Normal",
        error_explanation: "Несколько ответов отличаются от эталона. Ошибки повторяются в заданиях одного типа и требуют наблюдения в следующих тестах."
      });
    }

    // Student 20250801007: 15 answers, avg 90, 0 low scores
    for (let i = 0; i < 15; i++) {
      student_detailed_analyses.push({
        student_id: "20250801007",
        test_name: "Тест 2",
        question_id: `q_2_${i+1}`,
        ai_score_percent: 90,
        uniqueness_status: "Normal",
        error_explanation: "Критичных отклонений не найдено."
      });
    }

    return {
      global_course_summary: "Провалы в теме сложных многотабличных запросов",
      test_summaries: [
        {
          test_name: "Тест 2",
          critical_mass_errors: [
            { question_id: "q_3_2", fail_rate_percent: 50, error_pattern_description: "Студенты путают LEFT JOIN и INNER JOIN, выбирая неверные условия фильтрации.", methodological_reason: "Добавить интерактивный тренажер по JOIN." }
          ]
        }
      ],
      student_detailed_analyses,
      anomalies,
      course_recommendations: [
        { target: "Тест 2", action_item: "Добавить интерактивный тренажер по типам соединений таблиц JOIN.", priority: "Medium" }
      ]
    };
  }

  if (reportId === "3") {
    const student_detailed_analyses = [];
    const anomalies = [];

    // Student ab976c98-e4cb: 15 answers, avg 38, 8 low scores
    for (let i = 0; i < 15; i++) {
      student_detailed_analyses.push({
        student_id: "ab976c98-e4cb",
        test_name: "Тест 3",
        question_id: `q_3_${i+1}`,
        ai_score_percent: i < 8 ? 30 : 47,
        uniqueness_status: "Normal",
        error_explanation: "Средний AI-балл ниже 50%. Большая часть ответов не совпадает с эталоном, зафиксированы повторяющиеся ошибки по теме."
      });
    }
    anomalies.push({
      student_id: "ab976c98-e4cb",
      anomaly_type: "ExtremeStruggling",
      severity: "High",
      description: "Средний AI-балл ниже 50%. Большая часть ответов не совпадает с эталоном, зафиксированы повторяющиеся ошибки по теме."
    });

    // Student 20250801007: 14 answers, avg 92, 0 low scores
    for (let i = 0; i < 14; i++) {
      student_detailed_analyses.push({
        student_id: "20250801007",
        test_name: "Тест 3",
        question_id: `q_3_${i+1}`,
        ai_score_percent: 92,
        uniqueness_status: "Normal",
        error_explanation: "Критичных отклонений не найдено."
      });
    }

    return {
      global_course_summary: "Массовое несоблюдение стандартов доступности интерфейсов",
      test_summaries: [],
      student_detailed_analyses,
      anomalies,
      course_recommendations: []
    };
  }

  if (reportId === "4") {
    const student_detailed_analyses = [];
    const anomalies = [];

    // Student 20251010006: 14 answers, avg 55, 0 low scores
    for (let i = 0; i < 14; i++) {
      student_detailed_analyses.push({
        student_id: "20251010006",
        test_name: "Тест 4",
        question_id: `q_4_${i+1}`,
        ai_score_percent: 55,
        uniqueness_status: "Normal",
        error_explanation: "Небольшое отклонение от эталонного синтаксиса."
      });
    }

    // Student 20250801007: 14 answers, avg 92, 0 low scores
    for (let i = 0; i < 14; i++) {
      student_detailed_analyses.push({
        student_id: "20250801007",
        test_name: "Тест 4",
        question_id: `q_4_${i+1}`,
        ai_score_percent: 92,
        uniqueness_status: "Normal",
        error_explanation: "Критичных отклонений не найдено."
      });
    }

    return {
      global_course_summary: "Анализ базовых алгоритмов и структур данных",
      test_summaries: [],
      student_detailed_analyses,
      anomalies,
      course_recommendations: []
    };
  }

  return null;
}

// Initial Mock Reports Data representing ChatGPT-like dialog history
const initialMockReports = [
  {
    id: "1",
    course: "Электронный курс Python",
    title: "Выявлены аномалии в промежуточных тестах и синтаксисе",
    errors: [
      { priority: "high", val: "65%", question: "Вопрос q_1_1", text: "Студенты массово выбирают неверный вариант с приставкой. Вероятная причина: путаница между звонкими и глухими согласными." },
      { priority: "medium", val: "42%", question: "Вопрос q_1_6", text: "Часть ответов совпадает с эталоном символ в символ, включая редкие опечатки." }
    ],
    recommendations: [
      "Добавить короткую справку по правописанию приставок.",
      "Перемешать варианты ответов в промежуточном тесте.",
      "Проверить студентов с аномально коротким временем прохождения."
    ],
    status: "Completed",
    result: generateMockResult("1")
  },
  {
    id: "2",
    course: "Базы данных & SQL",
    title: "Провалы в теме сложных многотабличных запросов",
    errors: [
      { priority: "high", val: "50%", question: "Вопрос q_3_2", text: "Студенты путают LEFT JOIN и INNER JOIN, выбирая неверные условия фильтрации." },
      { priority: "medium", val: "30%", question: "Вопрос q_3_5", text: "Забывают использовать WHERE при операциях DELETE, что приводит к полной очистке таблиц в симуляторе." }
    ],
    recommendations: [
      "Добавить интерактивный тренажер по типам соединений таблиц JOIN.",
      "Включить предупреждающие подсказки в редактор запросов перед выполнением DELETE/UPDATE."
    ],
    status: "Completed",
    result: generateMockResult("2")
  },
  {
    id: "3",
    course: "Веб-дизайн UX/UI",
    title: "Массовое несоблюдение стандартов доступности интерфейсов",
    errors: [
      { priority: "high", val: "75%", question: "Вопрос q_UX_4", text: "Студенты не смогли верно рассчитать коэффициент контрастности для текста на цветном фоне." },
      { priority: "low", val: "25%", question: "Вопрос q_UX_7", text: "Аномальное совпадение цветовых палитр, вероятные признаки списывания дизайна." }
    ],
    recommendations: [
      "Провести вебинар или добавить практикум по стандартам веб-доступности WCAG.",
      "Разнообразить индивидуальные задания на проектирование цветовых схем."
    ],
    status: "Completed",
    result: generateMockResult("3")
  },
  {
    id: "4",
    course: "Введение в программирование",
    title: "Анализ базовых алгоритмов и структур данных",
    errors: [],
    recommendations: [],
    status: "Completed",
    result: generateMockResult("4")
  }
];

function App() {
  const [route, setRoute] = useState(() => {
    return window.location.hash.replace("#", "") || "upload";
  });
  const [mockReports, setMockReports] = useState([]);
  const [selectedModel, setSelectedModel] = useState(enabledModels[0]?.value || "");
  const [selectedBenchFile, setSelectedBenchFile] = useState(null);
  const [selectedResponseFiles, setSelectedResponseFiles] = useState([]);
  const showValidation = Boolean(selectedBenchFile && selectedResponseFiles.length > 0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("Uploading");
  const [analysisSubmittedAt, setAnalysisSubmittedAt] = useState(null);
  const [analysisChecks, setAnalysisChecks] = useState({});
  const [analysisTaskId, setAnalysisTaskId] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [toasts, setToasts] = useState([]);
  const [archiveTargetId, setArchiveTargetId] = useState("");
  const [archivedReports, setArchivedReports] = useState([]);
  const [userSettings, setUserSettings] = useState(() => readLocalSettings());
  const [layoutPreferences, setLayoutPreferences] = useState(() => readLayoutPreferences());
  const [systemThemeTick, setSystemThemeTick] = useState(0);

  // Authentication states
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [user, setUser] = useState(() => localStorage.getItem("username") || "");
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("userEmail") || "");
  const [authError, setAuthError] = useState("");

  // Login form states
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register form states
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");

  const benchInputRef = useRef(null);
  const responsesInputRef = useRef(null);
  const saveActionsRef = useRef(null);
  const profileActionsRef = useRef(null);
  const stopAnalysisPollingRef = useRef(null);

  // Naming & Renaming states
  const [showNamingModal, setShowNamingModal] = useState(false);
  const [namingTaskId, setNamingTaskId] = useState("");
  const [namingValue, setNamingValue] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [stoppingTaskId, setStoppingTaskId] = useState(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [isEditingReportContent, setIsEditingReportContent] = useState(false);

  const updateLayoutPreferences = (patch) => {
    setLayoutPreferences((currentPreferences) => ({
      ...currentPreferences,
      ...patch,
    }));
  };

  const handleMainSidebarToggle = () => {
    updateLayoutPreferences({
      isMainSidebarCollapsed: !layoutPreferences.isMainSidebarCollapsed,
    });
  };

  const handleSettingsSidebarToggle = () => {
    updateLayoutPreferences({
      isSettingsSidebarCollapsed: !layoutPreferences.isSettingsSidebarCollapsed,
    });
  };

  const handleSidebarResizeStart = (panel, event) => {
    if (window.matchMedia?.("(max-width: 980px)")?.matches) return;

    event.preventDefault();
    const limits = layoutLimits[panel];
    const panelLeft = event.currentTarget.parentElement?.getBoundingClientRect().left || 0;

    const handlePointerMove = (moveEvent) => {
      const nextWidth = moveEvent.clientX - panelLeft;

      if (nextWidth < limits.collapseBelow) {
        updateLayoutPreferences(
          panel === "main"
            ? { isMainSidebarCollapsed: true }
            : { isSettingsSidebarCollapsed: true }
        );
        return;
      }

      const maxWidth = getSidebarMaxWidth(limits);
      const clampedWidth = Math.min(maxWidth, Math.max(limits.min, nextWidth));
      updateLayoutPreferences(
        panel === "main"
          ? { mainSidebarWidth: clampedWidth, isMainSidebarCollapsed: false }
          : { settingsSidebarWidth: clampedWidth, isSettingsSidebarCollapsed: false }
      );
    };

    const handlePointerUp = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      document.body.classList.remove("is-resizing-sidebar");
    };

    document.body.classList.add("is-resizing-sidebar");
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp, { once: true });
    document.addEventListener("pointercancel", handlePointerUp, { once: true });
  };
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [manualCourse, setManualCourse] = useState("Новый локальный курс");
  const [manualTitle, setManualTitle] = useState("Черновик offline-отчета");

  const notify = (toast) => {
    const id = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id, type: "info", ...toast }]);
    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((currentToast) => currentToast.id !== id));
    }, toast.duration || 4200);
  };

  const dismissToast = (toastId) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const recordAnalysisCheck = (taskId, status) => {
    setAnalysisChecks(current => ({ ...current, [taskId]: { checkedAt: Date.now(), status, error: false } }));
  };

  useEffect(() => {
    const expireSession = () => {
      stopAnalysisPollingRef.current?.();
      setIsAnalyzing(false);
      setAnalysisChecks({});
      setShowNamingModal(false);
      setIsProfileMenuOpen(false);
      setToken("");
      setUser("");
      setUserEmail("");
      setMockReports([]);
      setArchivedReports([]);
      setLoginEmail(localStorage.getItem("userEmail") || "");
      setAuthError(SESSION_EXPIRED_MESSAGE);
      setRoute("login");
      navigateTo("login");
    };
    const syncSession = (event) => {
      if (event.key !== "token") return;
      if (!event.newValue) expireSession();
      else {
        stopAnalysisPollingRef.current?.();
        setIsAnalyzing(false);
        setToken(event.newValue);
        setUser(localStorage.getItem("username") || "");
        setUserEmail(localStorage.getItem("userEmail") || "");
        setAuthError("");
        navigateTo("upload");
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    window.addEventListener("storage", syncSession);
    return () => {
      stopAnalysisPollingRef.current?.();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const handleSettingsChange = async (patch) => {
    const nextSettings = {
      ...userSettings,
      ...patch,
    };
    setUserSettings(nextSettings);

    const { settings } = await persistUserSettings(nextSettings);
    setUserSettings(settings);
  };

  const mapReportFromApi = (apiReport) => {
    const result = apiReport.result || {};
    const mappedErrors = [];
    if (result.test_summaries) {
      result.test_summaries.forEach((ts) => {
        if (ts.critical_mass_errors) {
          ts.critical_mass_errors.forEach((err) => {
            mappedErrors.push({
              priority: err.fail_rate_percent >= 60 ? "high" : "medium",
              val: `${Math.round(err.fail_rate_percent)}%`,
              question: `${ts.test_name}: Вопрос ${err.question_id}`,
              text: `${err.error_pattern_description} (Причина: ${err.methodological_reason})`,
              testName: ts.test_name,
              questionId: err.question_id,
              failRate: err.fail_rate_percent,
              errorDescription: err.error_pattern_description,
              methodologicalReason: err.methodological_reason,
            });
          });
        }
      });
    }

    const mappedRecommendations = [];
    if (result.course_recommendations) {
      result.course_recommendations.forEach((rec) => {
        mappedRecommendations.push(`[${rec.priority}] ${rec.target}: ${rec.action_item}`);
      });
    }

    return {
      id: apiReport.id,
      course: apiReport.courseName || "Электронный курс",
      title: result.global_course_summary || (apiReport.status === "Cancelled" ? "Анализ остановлен" : ["Queued", "Retrying", "Processing", "Cancelling"].includes(apiReport.status) ? "Анализ выполняется..." : "Анализ провалился"),
      errors: mappedErrors,
      recommendations: mappedRecommendations,
      status: apiReport.status,
      error: apiReport.error,
      isArchived: Boolean(apiReport.isArchived),
      createdAt: apiReport.createdAt,
      result: apiReport.result
    };
  };

  const fetchHistory = async () => {
    const requestToken = localStorage.getItem("token");
    if (!requestToken) return;
    try {
      const historyData = await getAnalysisHistory();
      if (localStorage.getItem("token") !== requestToken) return;
      if (Array.isArray(historyData)) {
        const mapped = isOfflineMode ? historyData : historyData.map(mapReportFromApi);
        setMockReports(mapped);
        const checkedAt = Date.now();
        setAnalysisChecks(current => ({
          ...current,
          ...Object.fromEntries(mapped.filter(report => ["Queued", "Retrying", "Processing", "Cancelling"].includes(report.status))
            .map(report => [report.id, { checkedAt, status: report.status, error: false }])),
        }));
      }
    } catch (err) {
      console.error("Failed to fetch analysis history:", err);
    }
  };

  const fetchArchivedHistory = async () => {
    const requestToken = localStorage.getItem("token");
    if (!requestToken) return;
    try {
      const historyData = await getAnalysisHistory({ onlyArchived: true });
      if (localStorage.getItem("token") !== requestToken) return;
      if (Array.isArray(historyData)) {
        const mapped = isOfflineMode ? historyData : historyData.map(mapReportFromApi);
        setArchivedReports(mapped);
      }
    } catch (err) {
      console.error("Failed to fetch archived analysis history:", err);
    }
  };

  useEffect(() => {
    seedOfflineReports(initialMockReports);
  }, []);

  useEffect(() => {
    if (token) {
      fetchHistory();
      fetchArchivedHistory();
    } else {
      setMockReports([]);
      setArchivedReports([]);
    }
  }, [token]);

  useEffect(() => {
    let ignore = false;

    const syncSettings = async () => {
      const { settings } = token
        ? await loadUserSettings()
        : { settings: readLocalSettings() };

      if (!ignore) {
        setUserSettings(settings);
      }
    };

    syncSettings();

    return () => {
      ignore = true;
    };
  }, [token]);

  useEffect(() => {
    writeLayoutPreferences(layoutPreferences);
  }, [layoutPreferences]);

  useEffect(() => {
    const root = document.documentElement;
    const isSystemDark =
      userSettings.theme === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const effectiveTheme = userSettings.theme === "system"
      ? (isSystemDark ? "dark" : "light")
      : userSettings.theme;

    root.dataset.theme = effectiveTheme;
    root.dataset.themePreference = userSettings.theme;
    const accessibility = userSettings.accessibility || {};
    root.dataset.accessibility = accessibility.enabled ? "enabled" : "default";
    root.dataset.fontSize = accessibility.enabled ? (accessibility.fontSize || "xxlarge") : "normal";
    root.dataset.contrast = accessibility.enabled ? (accessibility.colorScheme || "dark") : "standard";
    root.dataset.lineSpacing = accessibility.enabled ? "wide" : "normal";
    root.dataset.letterSpacing = accessibility.enabled ? "wide" : "normal";
    root.dataset.density = userSettings.minimalUi ? "minimal" : "comfortable";
    document.body.dataset.density = root.dataset.density;
  }, [userSettings, systemThemeTick]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) return;

    const handleSystemThemeChange = () => {
      setSystemThemeTick((tick) => tick + 1);
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, []);

  useEffect(() => {
    const processing = mockReports.filter(r => ["Queued", "Retrying", "Processing", "Cancelling"].includes(r.status));
    if (!token || !processing.length) return;
    let stopped = false;
    let timer;
    const refreshStatuses = async () => {
      try {
        const statuses = await Promise.all(processing.map(report => getAnalysisStatus(report.id)));
        if (!stopped) {
          const checkedAt = Date.now();
          setAnalysisChecks(current => ({
            ...current,
            ...Object.fromEntries(statuses.map((status, index) => [processing[index].id, { checkedAt, status: status.status, error: false }])),
          }));
        }
        if (!stopped && statuses.some((status, index) => status.status !== processing[index].status)) {
          await fetchHistory();
        }
      } catch (error) {
        if (error.status === 401) return;
        if (!stopped) setAnalysisChecks(current => ({
          ...current,
          ...Object.fromEntries(processing.map(report => [report.id, { ...current[report.id], error: true }])),
        }));
        console.error("Failed to refresh analysis status:", error);
      }
      if (!stopped) timer = setTimeout(refreshStatuses, 5000);
    };
    timer = setTimeout(refreshStatuses, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [mockReports, token]);

  // Sync route with window hash and enforce route protection
  useEffect(() => {
    const handleHashChange = () => {
      const newRoute = window.location.hash.replace("#", "") || "upload";
      
      const isAuthRoute = newRoute === "login" || newRoute === "register";
      const hasToken = !!localStorage.getItem("token");

      if (!hasToken && !isAuthRoute) {
        navigateTo("login");
      } else if (hasToken && isAuthRoute) {
        navigateTo("upload");
      } else {
        setRoute(newRoute);
      }
      setIsEditingTitle(false); // Reset inline edit state on navigation
      setIsEditingReportContent(false);
      setIsSaveMenuOpen(false);
      setIsProfileMenuOpen(false);
      setIsMenuOpen(false); // Close mobile drawer on route change
    };

    const initialRoute = window.location.hash.replace("#", "") || "upload";
    const isAuthRoute = initialRoute === "login" || initialRoute === "register";
    const hasToken = !!localStorage.getItem("token");

    if (!hasToken && !isAuthRoute) {
      navigateTo("login");
      setRoute("login");
    } else if (hasToken && isAuthRoute) {
      navigateTo("upload");
      setRoute("upload");
    } else {
      setRoute(initialRoute);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Update document title dynamically
  useEffect(() => {
    document.title = "НейроЭксперт — личный кабинет";
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const isOutsideSaveMenu = isSaveMenuOpen && !saveActionsRef.current?.contains(event.target);
      const isOutsideProfileMenu = isProfileMenuOpen && !profileActionsRef.current?.contains(event.target);

      if (!isOutsideSaveMenu && !isOutsideProfileMenu) return;

      if (isOutsideSaveMenu) {
        setIsSaveMenuOpen(false);
      }
      if (isOutsideProfileMenu) {
        setIsProfileMenuOpen(false);
      }

      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent?.stopImmediatePropagation?.();
      event.stopImmediatePropagation?.();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isSaveMenuOpen, isProfileMenuOpen]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      if (!loginEmail || !loginPassword) {
        throw new Error("Заполните все поля.");
      }
      const data = await login(loginEmail, loginPassword);
      if (data && data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("username", data.username);
        localStorage.setItem("userEmail", loginEmail);
        setToken(data.token);
        setUser(data.username);
        setUserEmail(loginEmail);
        setLoginEmail("");
        setLoginPassword("");
        navigateTo("upload");
      } else {
        throw new Error("Неверный формат ответа сервера.");
      }
    } catch (err) {
      setAuthError(err.message || "Ошибка авторизации.");
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      if (!registerUsername || !registerEmail || !registerPassword) {
        throw new Error("Заполните все поля.");
      }
      if (registerPassword.length < 6) {
        throw new Error("Пароль должен быть не менее 6 символов.");
      }
      const data = await register(registerUsername, registerEmail, registerPassword);
      if (data && data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("username", data.username);
        localStorage.setItem("userEmail", registerEmail);
        setToken(data.token);
        setUser(data.username);
        setUserEmail(registerEmail);
        setRegisterUsername("");
        setRegisterEmail("");
        setRegisterPassword("");
        navigateTo("upload");
      } else {
        throw new Error("Неверный формат ответа сервера.");
      }
    } catch (err) {
      setAuthError(err.message || "Ошибка регистрации.");
    }
  };

  const handleLogout = () => {
    stopAnalysisPollingRef.current?.();
    setAnalysisChecks({});
    resetUploadForm();
    setShowNamingModal(false);
    setIsProfileMenuOpen(false);
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("userEmail");
    setToken("");
    setUser("");
    setUserEmail("");
    setRoute("login");
    navigateTo("login");
  };

  // Handle responsive mobile drawer class toggles on body
  useEffect(() => {
    document.body.classList.toggle("menu-open", isMenuOpen);
  }, [isMenuOpen]);

  const getPageTitle = (currentRoute) => {
    if (currentRoute === "upload") return "Загрузка данных";
    if (currentRoute.startsWith("report-detail-")) return "Детали отчёта";
    if (currentRoute === "students") return "Студенты";
    if (currentRoute === "settings") return "Настройки";
    if (currentRoute === "login") return "Авторизация";
    if (currentRoute === "register") return "Регистрация";
    return "НейроЭксперт";
  };

  const handleFileChange = (e, type) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (type === "bench") {
      setSelectedBenchFile(files[0]);
    } else if (type === "responses") {
      setSelectedResponseFiles(Array.from(files));
    }
  };

  const resetUploadForm = () => {
    setSelectedBenchFile(null);
    setSelectedResponseFiles([]);
    setIsAnalyzing(false);
    setAnalysisStatus("Uploading");
    setAnalysisSubmittedAt(null);
    if (benchInputRef.current) benchInputRef.current.value = "";
    if (responsesInputRef.current) responsesInputRef.current.value = "";
  };

  const stopGeneration = async (taskId) => {
    if (!taskId || stoppingTaskId) return;
    setStoppingTaskId(taskId);
    try {
      const result = await cancelAnalysis(taskId);
      recordAnalysisCheck(taskId, result.status);
      if (taskId === analysisTaskId) {
        setAnalysisStatus(result.status);
        if (result.status === "Cancelled") setIsAnalyzing(false);
      }
      await fetchHistory();
      notify({ type: "info", title: result.status === "Cancelled" ? "Анализ остановлен" : "Остановка запрошена", message: "Автоматического повторного запуска не будет." });
    } catch (error) {
      if (error.status !== 401) notify({ type: "error", title: "Не удалось остановить анализ", message: error.message });
      await fetchHistory();
    } finally { setStoppingTaskId(null); }
  };

  const startAnalysis = async () => {
    if (isAnalyzing) return;
    if (!selectedBenchFile || selectedResponseFiles.length === 0) {
      notify({
        type: "warning",
        title: "Не хватает файлов",
        message: "Выберите эталонный файл и файлы ответов перед запуском анализа.",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisStatus("Uploading");
    setAnalysisSubmittedAt(Date.now());
    setAnalysisTaskId("Отправка...");
    const uploadSessionToken = localStorage.getItem("token");

    try {
      const data = await uploadFiles(selectedBenchFile, selectedResponseFiles, selectedModel);
      if (localStorage.getItem("token") !== uploadSessionToken) return;
      
      const serverTaskId = data.task_id;
      setAnalysisTaskId(serverTaskId);

      // Show success alert showing that files were successfully sent and accepted
      notify({
        type: "success",
        title: "Файлы приняты",
        message: data.message || "Файлы успешно отправлены и приняты в обработку.",
      });

      setAnalysisStatus("Queued");
      recordAnalysisCheck(serverTaskId, "Queued");

      await fetchHistory();
      if (!uploadSessionToken || localStorage.getItem("token") !== uploadSessionToken) return;
      stopAnalysisPollingRef.current?.();
      stopAnalysisPollingRef.current = watchAnalysis({
        getStatus: () => getAnalysisStatus(serverTaskId),
        onStatus: async (statusRes) => {
          recordAnalysisCheck(serverTaskId, statusRes.status);
          setAnalysisStatus(statusRes.status);
          if (statusRes.status === "Completed") {
            await fetchHistory();
            if (localStorage.getItem("token") !== uploadSessionToken) return;
            const cleanBenchName = selectedBenchFile.name.replace(/\.[^/.]+$/, "");
            const cleanResponseName = selectedResponseFiles[0].name.replace(/\.[^/.]+$/, "");
            const courseName = `${cleanBenchName} & ${cleanResponseName}${
              selectedResponseFiles.length > 1 ? ` +${selectedResponseFiles.length - 1}` : ""
            }`;

            setNamingTaskId(serverTaskId);
            setNamingValue(courseName);
            setShowNamingModal(true);
            resetUploadForm();
          } else if (statusRes.status === "Cancelled") {
            setIsAnalyzing(false);
            await fetchHistory();
            notify({ type: "info", title: "Анализ остановлен", message: "Чтобы начать заново, запустите новый анализ." });
          } else if (statusRes.status === "Failed") {
            setIsAnalyzing(false);
            await fetchHistory();
            if (localStorage.getItem("token") !== uploadSessionToken) return;
            notify({
              type: "error",
              title: "Анализ провалился",
              message: statusRes.error || "Неизвестная ошибка на стороне сервера.",
            });
          }
        },
        onError: (error) => {
          setIsAnalyzing(false);
          if (error.status === 401) return;
          notify({
            type: "error",
            title: "Не удалось обновить статус",
            message: `${error.message} Задача сохранена в истории; повторно отправлять файлы не нужно.`,
          });
        },
      });

    } catch (err) {
      setIsAnalyzing(false);
      if (err.status === 401) return;
      notify({
        type: "error",
        title: "Не удалось отправить файлы",
        message: err.message,
      });
    }
  };

  const handleSaveReportName = async (e) => {
    if (e) e.preventDefault();
    if (!namingValue.trim()) {
      notify({
        type: "warning",
        title: "Введите название",
        message: "Название поможет быстро найти отчет в истории.",
      });
      return;
    }
    setIsSavingName(true);
    try {
      await renameAnalysisReport(namingTaskId, namingValue);
      await fetchHistory();
      setShowNamingModal(false);
      notify({
        type: "success",
        title: "Название сохранено",
        message: "Отчет добавлен в историю анализов.",
      });
      navigateTo(`report-detail-${namingTaskId}`);
    } catch (err) {
      notify({
        type: "error",
        title: "Не удалось сохранить название",
        message: err.message,
      });
    } finally {
      setIsSavingName(false);
    }
  };

  const handleSkipNaming = async () => {
    setShowNamingModal(false);
    await fetchHistory();
    navigateTo(`report-detail-${namingTaskId}`);
  };

  const handleInlineRenameSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!editTitleValue.trim()) return;

    const reportId = route.replace("report-detail-", "");
    try {
      await renameAnalysisReport(reportId, editTitleValue);
      await fetchHistory();
      setIsEditingTitle(false);
      notify({
        type: "success",
        title: "Отчет переименован",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Не удалось переименовать отчет",
        message: err.message,
      });
    }
  };

  const persistOfflineReport = (reportId, patch) => {
    setMockReports((reports) =>
      reports.map((report) => (report.id === reportId ? { ...report, ...patch } : report))
    );
    updateOfflineReport(reportId, patch).catch((err) => {
      notify({
        type: "error",
        title: "Не удалось сохранить изменения",
        message: err.message,
      });
    });
  };

  const handleReportFieldChange = (reportId, field, value) => {
    persistOfflineReport(reportId, { [field]: value });
  };

  const handleFindingChange = (report, index, field, value) => {
    const nextErrors = report.errors.map((error, currentIndex) =>
      currentIndex === index ? { ...error, [field]: value } : error
    );
    persistOfflineReport(report.id, { errors: nextErrors });
  };

  const addFinding = (report) => {
    persistOfflineReport(report.id, {
      errors: [
        ...report.errors,
        {
          priority: "medium",
          val: "25%",
          question: "Новый вопрос",
          text: "Опишите найденную массовую ошибку.",
        },
      ],
    });
  };

  const removeFinding = (report, index) => {
    persistOfflineReport(report.id, {
      errors: report.errors.filter((_, currentIndex) => currentIndex !== index),
    });
  };

  const handleRecommendationChange = (report, index, value) => {
    const nextRecommendations = report.recommendations.map((recommendation, currentIndex) =>
      currentIndex === index ? value : recommendation
    );
    persistOfflineReport(report.id, { recommendations: nextRecommendations });
  };

  const addRecommendation = (report) => {
    persistOfflineReport(report.id, {
      recommendations: [...report.recommendations, "Новая рекомендация для методиста."],
    });
  };

  const removeRecommendation = (report, index) => {
    persistOfflineReport(report.id, {
      recommendations: report.recommendations.filter((_, currentIndex) => currentIndex !== index),
    });
  };

  const handleCreateManualReport = async (e) => {
    e.preventDefault();
    try {
      const report = await createOfflineReport({
        course: manualCourse.trim() || "Новый локальный курс",
        title: manualTitle.trim() || "Черновик offline-отчета",
        errors: [
          {
            priority: "medium",
            val: "30%",
            question: "Вопрос q_demo",
            text: "Черновая находка для ручного редактирования в песочнице.",
          },
        ],
        recommendations: ["Уточните содержание отчета в редакторе offline mode."],
      });
      await fetchHistory();
      navigateTo(`report-detail-${report.id}`);
      notify({
        type: "success",
        title: "Черновик создан",
        message: "Отчет открыт для просмотра и редактирования.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Не удалось создать отчет",
        message: err.message,
      });
    }
  };

  const handleArchiveReport = async (reportId) => {
    setArchiveTargetId(reportId);
  };

  const confirmArchiveReport = async () => {
    if (!archiveTargetId) return;
    try {
      await archiveAnalysisReport(archiveTargetId);
      await fetchHistory();
      await fetchArchivedHistory();
      setIsEditingReportContent(false);
      const archivedRoute = `report-detail-${archiveTargetId}`;
      setArchiveTargetId("");
      if (route === archivedRoute) {
        navigateTo("upload");
      }
      notify({
        type: "success",
        title: "Отчет архивирован",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Не удалось архивировать отчет",
        message: err.message,
      });
    }
  };

  const handleUnarchiveReport = async (reportId) => {
    try {
      await unarchiveAnalysisReport(reportId);
      await fetchHistory();
      await fetchArchivedHistory();
      notify({
        type: "success",
        title: "Отчет разархивирован",
        message: "Он снова доступен в основной истории.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Не удалось разархивировать отчет",
        message: err.message,
      });
    }
  };

  const handleExportReport = async (report, format) => {
    setIsSaveMenuOpen(false);
    try {
      const {
        exportReportToCsv,
        exportReportToJson,
        exportReportToPdf,
        exportReportToXlsx,
      } = await import("./reportExport");

      if (format === "pdf") {
        await exportReportToPdf(report);
        notify({ type: "success", title: "PDF сохранен" });
        return;
      }
      if (format === "excel") {
        await exportReportToXlsx(report);
        notify({ type: "success", title: "Excel сохранен" });
        return;
      }
      if (format === "csv") {
        exportReportToCsv(report);
        notify({ type: "success", title: "CSV сохранен" });
        return;
      }
      exportReportToJson(report);
      notify({ type: "success", title: "JSON сохранен" });
    } catch (err) {
      console.error("Failed to export report:", err);
      notify({
        type: "error",
        title: "Не удалось сохранить файл",
        message: err.message || "Повторите экспорт после обновления страницы.",
      });
    }
  };

  const renderActivePage = () => {
    if (route === "upload") {
      return (
        <section className="page active" id="upload" data-title="Загрузка данных">
          {!isAnalyzing ? (
            <div className="split upload-layout" id="upload-form-panel">
              <section className="panel">
                <p className="eyebrow">Новый анализ</p>
                <h2>Загрузите эталон и ответы студентов</h2>
                <p className="muted">Поддерживаются CSV, XLS и XLSX (для ответов также поддерживаются ZIP-архивы). Если файл пустой или в нём не хватает колонок, система покажет понятную ошибку до запуска ИИ.</p>

                <div
                  className="dropzone"
                  id="bench-dropzone"
                  style={{ cursor: "pointer" }}
                  onClick={() => benchInputRef.current.click()}
                >
                  <span><Upload size={30} strokeWidth={2.2} /></span>
                  <strong id="bench-file-name">{selectedBenchFile ? selectedBenchFile.name : "Эталонный файл"}</strong>
                  <p>Кликните для выбора benchmark.csv, benchmark.xls или benchmark.xlsx</p>
                  <input
                    type="file"
                    id="bench-input"
                    ref={benchInputRef}
                    style={{ display: "none" }}
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => handleFileChange(e, "bench")}
                  />
                </div>

                <div
                  className="dropzone compact"
                  id="responses-dropzone"
                  style={{ cursor: "pointer", marginTop: "14px" }}
                  onClick={() => responsesInputRef.current.click()}
                >
                  <span><Files size={30} strokeWidth={2.2} /></span>
                  <strong id="responses-file-name">
                    {selectedResponseFiles.length === 0
                      ? "Файлы с ответами"
                      : selectedResponseFiles.length === 1
                      ? selectedResponseFiles[0].name
                      : `Выбрано файлов: ${selectedResponseFiles.length}`}
                  </strong>
                  <p>Кликните для выбора файлов (.csv, .xls, .xlsx) или ZIP-архива</p>
                  <input
                    type="file"
                    id="responses-input"
                    ref={responsesInputRef}
                    style={{ display: "none" }}
                    multiple
                    accept=".csv,.xlsx,.xls,.zip"
                    onChange={(e) => handleFileChange(e, "responses")}
                  />
                </div>
              </section>

              <section className="panel">
                <p className="eyebrow">Параметры</p>
                <h3>Выбор ИИ-модели</h3>
                <label className="field-label">ИИ-модель</label>
                <div className="segmented" id="model-selector-container">
                  {enabledModels.map((model) => (
                    <button
                      key={model.value}
                      type="button"
                      className={selectedModel === model.value ? "selected" : ""}
                      onClick={() => setSelectedModel(model.value)}
                    >
                      {model.label}
                    </button>
                  ))}
                </div>
                {enabledModels.length === 0 && (
                  <div className="validation-box" style={{ marginTop: "16px" }}>
                    <b>AI-провайдер не настроен</b>
                    <p>История и настройки доступны. Для нового анализа администратор должен включить модель.</p>
                  </div>
                )}

                {showValidation && (
                  <div className="validation-box" id="upload-validation-box" style={{ marginTop: "20px" }}>
                    <b>Файлы выбраны</b>
                    <p>Структура и содержимое будут проверены после отправки.</p>
                  </div>
                )}

                <button
                  className="primary-button wide"
                  id="start-analysis-btn"
                  style={{ marginTop: "20px", width: "100%" }}
                  onClick={startAnalysis}
                  disabled={enabledModels.length === 0}
                >
                  Запустить анализ
                </button>

                {isOfflineMode && (
                  <form className="offline-create-form" onSubmit={handleCreateManualReport}>
                    <p className="eyebrow">Offline песочница</p>
                    <h3>Создать отчет вручную</h3>
                    <label>
                      Название курса
                      <input
                        type="text"
                        value={manualCourse}
                        onChange={(e) => setManualCourse(e.target.value)}
                      />
                    </label>
                    <label>
                      Заголовок отчета
                      <textarea
                        rows="3"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                      />
                    </label>
                    <button type="submit" className="secondary-button wide">
                      Создать черновик
                    </button>
                  </form>
                )}
              </section>
            </div>
          ) : (
            <AnalysisProgress
              createdAt={mockReports.find(report => report.id === analysisTaskId)?.createdAt || analysisSubmittedAt}
              status={analysisStatus}
              check={analysisChecks[analysisTaskId]}
              isOfflineMode={isOfflineMode}
              onStop={() => stopGeneration(analysisTaskId)}
              stopping={stoppingTaskId === analysisTaskId}
            />
          )}
        </section>
      );
    }

    if (route.startsWith("report-detail-")) {
      const reportId = route.replace("report-detail-", "");
      const report = mockReports.find((r) => r.id === reportId);

      if (!report) {
      return (
        <section className="page active">
          <div className="state-panel">
            <span className="state-icon state-icon-warm">
              <XCircle size={28} strokeWidth={2.2} />
            </span>
            <h2>Отчёт не найден</h2>
            <p className="muted">Пожалуйста, выберите существующий отчёт из истории в левой панели.</p>
          </div>
          </section>
        );
      }

      if (["Queued", "Retrying", "Processing", "Cancelling"].includes(report.status)) {
        return (
          <section className="page active" id="report-detail" data-title="Детали отчёта">
            <AnalysisProgress createdAt={report.createdAt} status={report.status} check={analysisChecks[report.id]} isOfflineMode={isOfflineMode} onStop={() => stopGeneration(report.id)} stopping={stoppingTaskId === report.id} />
          </section>
        );
      }

      if (report.status === "Cancelled") {
        return <section className="page active" id="report-detail" data-title="Детали отчёта">
          <div className="state-panel"><h2>Анализ остановлен</h2><p className="muted">Обработка отменена. Для нового отчёта загрузите файлы и запустите анализ заново.</p>
            <button className="secondary-button" onClick={() => navigateTo("upload")}>Новый анализ</button>
          </div>
        </section>;
      }

      if (report.status === "Failed") {
        return (
          <section className="page active" id="report-detail" data-title="Детали отчёта">
            <div className="state-panel state-panel-danger">
              <span className="state-icon state-icon-danger">
                <XCircle size={28} strokeWidth={2.2} />
              </span>
              <h2>Анализ провалился</h2>
              <p className="muted">
                Ошибка: {report.error || "Неизвестная ошибка на стороне сервера."}
              </p>
            </div>
          </section>
        );
      }

      return (
        <section className="page active" id="report-detail" data-title="Детали отчёта">
          <div className="report-header">
            <div>
              {isEditingTitle ? (
                <form onSubmit={handleInlineRenameSubmit} className="inline-rename-form">
                  <input
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    className="inline-rename-input"
                    required
                    autoFocus
                  />
                  <button type="submit" className="primary-button inline-rename-button">
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="ghost-button inline-rename-button"
                    onClick={() => setIsEditingTitle(false)}
                  >
                    Отмена
                  </button>
                </form>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <p className="eyebrow" id="report-course-eyebrow" style={{ margin: 0 }}>{report.course}</p>
                  <button
                    type="button"
                    className="inline-icon-button"
                    onClick={() => {
                      setEditTitleValue(report.course);
                      setIsEditingTitle(true);
                    }}
                    aria-label="Переименовать отчет"
                    title="Переименовать отчет"
                  >
                    <Pencil size={14} strokeWidth={2.2} />
                  </button>
                </div>
              )}
              <h2 id="report-title-heading">{report.title}</h2>
              {report.result?.quality_status === "degraded" && (
                <div className="quality-notice" role="status">
                  <b>Результат с ограничениями.</b>{" "}
                  При обработке обнаружены замечания к исходным данным или пояснениям.
                  {Array.isArray(report.result.limitations) && report.result.limitations.length > 0 && (
                    <span> {report.result.limitations.join(" ")}</span>
                  )}
                </div>
              )}
              {report.result?.data_notes?.length > 0 && (
                <p className="muted">{report.result.data_notes.join(" ")}</p>
              )}
            </div>
            <div className="export-actions">
              {isOfflineMode && (
                <button
                  type="button"
                  className={`icon-action-button edit-action ${isEditingReportContent ? "active" : ""}`}
                  onClick={() => setIsEditingReportContent(!isEditingReportContent)}
                  aria-label={isEditingReportContent ? "Завершить редактирование" : "Редактировать отчет"}
                  title={isEditingReportContent ? "Готово" : "Редактировать"}
                >
                  <Pencil size={18} strokeWidth={2.2} />
                </button>
              )}
              <button
                type="button"
                className="icon-action-button archive-action"
                onClick={() => handleArchiveReport(report.id)}
                aria-label="Архивировать"
                title="Архивировать"
              >
                <Archive size={18} strokeWidth={2.2} />
              </button>
              <div className="save-actions" ref={saveActionsRef}>
                <button
                  type="button"
                  className="icon-action-button save-action"
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    setIsSaveMenuOpen((isOpen) => !isOpen);
                  }}
                  aria-expanded={isSaveMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Сохранить"
                  title="Сохранить"
                >
                  <Save size={18} strokeWidth={2.2} />
                </button>
                {isSaveMenuOpen && (
                  <div className="save-menu" role="menu">
                    {["pdf", "excel", "csv", "json"].map((format) => (
                      <button
                        key={format}
                        type="button"
                        role="menuitem"
                        onClick={() => handleExportReport(report, format)}
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {isEditingReportContent && isOfflineMode ? (
            <div className="grid two">
              <section className="panel report-editor">
                <h3>Содержание отчета</h3>
                <label>
                  Название курса
                  <input
                    type="text"
                    value={report.course}
                    onChange={(e) => handleReportFieldChange(report.id, "course", e.target.value)}
                  />
                </label>
                <label>
                  Заголовок отчета
                  <textarea
                    rows="4"
                    value={report.title}
                    onChange={(e) => handleReportFieldChange(report.id, "title", e.target.value)}
                  />
                </label>
              </section>

              <section className="panel report-editor">
                <div className="section-heading">
                  <h3>Рекомендации</h3>
                  <button type="button" className="secondary-button" onClick={() => addRecommendation(report)}>
                    Добавить
                  </button>
                </div>
                <div className="editor-list">
                  {report.recommendations.map((rec, i) => (
                    <div key={i} className="editor-row">
                      <textarea
                        rows="3"
                        value={rec}
                        onChange={(e) => handleRecommendationChange(report, i, e.target.value)}
                      />
                      <button type="button" className="ghost-button delete-action" onClick={() => removeRecommendation(report, i)}>
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel report-editor editor-wide">
                <div className="section-heading">
                  <h3>Критичные массовые ошибки</h3>
                  <button type="button" className="secondary-button" onClick={() => addFinding(report)}>
                    Добавить
                  </button>
                </div>
                <div className="editor-list">
                  {report.errors.map((err, i) => (
                    <div key={i} className="finding-editor">
                      <label>
                        Приоритет
                        <select
                          value={err.priority}
                          onChange={(e) => handleFindingChange(report, i, "priority", e.target.value)}
                        >
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="low">low</option>
                        </select>
                      </label>
                      <label>
                        Процент
                        <input
                          type="text"
                          value={err.val}
                          onChange={(e) => handleFindingChange(report, i, "val", e.target.value)}
                        />
                      </label>
                      <label>
                        Вопрос
                        <input
                          type="text"
                          value={err.question}
                          onChange={(e) => handleFindingChange(report, i, "question", e.target.value)}
                        />
                      </label>
                      <label className="editor-wide">
                        Описание
                        <textarea
                          rows="3"
                          value={err.text}
                          onChange={(e) => handleFindingChange(report, i, "text", e.target.value)}
                        />
                      </label>
                      <button type="button" className="ghost-button delete-action" onClick={() => removeFinding(report, i)}>
                        Удалить ошибку
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="grid report-content-grid">
              <ReportFindings key={report.id} errors={report.errors} />
              <ReportRecommendations recommendations={report.recommendations} details={isOfflineMode ? null : report.result?.course_recommendations} errors={report.errors} />
            </div>
          )}
        </section>
      );
    }

    if (route === "students") {
      return (
        <StudentsPage
          reports={mockReports}
          onNewAnalysis={() => {
            resetUploadForm();
            navigateTo("upload");
          }}
        />
      );
    }

    if (route === "settings") {
      return (
        <SettingsPage
          settings={userSettings}
          onSettingsChange={handleSettingsChange}
          sidebarWidth={layoutPreferences.settingsSidebarWidth}
          isSidebarCollapsed={layoutPreferences.isSettingsSidebarCollapsed}
          onSidebarToggle={handleSettingsSidebarToggle}
          onSidebarResizeStart={(event) => handleSidebarResizeStart("settings", event)}
          archivedReports={archivedReports}
          onUnarchiveReport={handleUnarchiveReport}
        />
      );
    }

    if (route === "login") {
      return (
        <AuthPage
          mode="login"
          authError={authError}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          registerUsername={registerUsername}
          registerEmail={registerEmail}
          registerPassword={registerPassword}
          onLoginEmailChange={setLoginEmail}
          onLoginPasswordChange={setLoginPassword}
          onRegisterUsernameChange={setRegisterUsername}
          onRegisterEmailChange={setRegisterEmail}
          onRegisterPasswordChange={setRegisterPassword}
          onSubmit={handleLoginSubmit}
          onClearError={() => setAuthError("")}
        />
      );
    }

    if (route === "register") {
      return (
        <AuthPage
          mode="register"
          authError={authError}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          registerUsername={registerUsername}
          registerEmail={registerEmail}
          registerPassword={registerPassword}
          onLoginEmailChange={setLoginEmail}
          onLoginPasswordChange={setLoginPassword}
          onRegisterUsernameChange={setRegisterUsername}
          onRegisterEmailChange={setRegisterEmail}
          onRegisterPasswordChange={setRegisterPassword}
          onSubmit={handleRegisterSubmit}
          onClearError={() => setAuthError("")}
        />
      );
    }

    return (
      <section className="page active">
        <div className="state-panel">
          <span className="state-icon state-icon-warm">
            <XCircle size={28} strokeWidth={2.2} />
          </span>
          <h2>Страница не найдена</h2>
          <a href="#upload" className="primary-button state-action">Назад на главную</a>
        </div>
      </section>
    );
  };

  const filteredReports = mockReports.filter((report) => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return true;
    return `${report.course} ${report.title}`.toLowerCase().includes(query);
  });

  const archiveTargetReport = mockReports.find((report) => report.id === archiveTargetId);
  const isAuthRoute = route === "login" || route === "register";

  if (isAuthRoute) {
    return (
      <>
        <AccessibilityToolbar settings={userSettings} onSettingsChange={handleSettingsChange} />
        <div className="auth-shell">
          {renderActivePage()}
        </div>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (route === "settings") {
    return (
      <>
        <AccessibilityToolbar settings={userSettings} onSettingsChange={handleSettingsChange} />
        {renderActivePage()}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <>
      <AccessibilityToolbar settings={userSettings} onSettingsChange={handleSettingsChange} />
      <AppLayout
        route={route}
        pageTitle={getPageTitle(route)}
        reports={filteredReports}
        historyQuery={historyQuery}
        onHistoryQueryChange={setHistoryQuery}
        onArchiveReport={handleArchiveReport}
        onNewAnalysis={() => {
          resetUploadForm();
          navigateTo("upload");
        }}
        token={token}
        user={user}
        userEmail={userEmail}
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        isProfileMenuOpen={isProfileMenuOpen}
        setIsProfileMenuOpen={setIsProfileMenuOpen}
        setIsSaveMenuOpen={setIsSaveMenuOpen}
        profileActionsRef={profileActionsRef}
        onLogout={handleLogout}
        settings={userSettings}
        sidebarWidth={layoutPreferences.mainSidebarWidth}
        isSidebarCollapsed={layoutPreferences.isMainSidebarCollapsed}
        onSidebarToggle={handleMainSidebarToggle}
        onSidebarResizeStart={(event) => handleSidebarResizeStart("main", event)}
      >
        {renderActivePage()}
      </AppLayout>

      <NamingDialog
        open={showNamingModal}
        value={namingValue}
        isSaving={isSavingName}
        onChange={setNamingValue}
        onSubmit={handleSaveReportName}
        onSkip={handleSkipNaming}
      />
      <ConfirmDialog
        open={!!archiveTargetId}
        title="Архивировать отчет?"
        message={`Отчет ${archiveTargetReport ? `«${archiveTargetReport.course}»` : ""} будет перемещен в архив. Его можно вернуть в настройках.`}
        confirmLabel="Архивировать"
        onConfirm={confirmArchiveReport}
        onCancel={() => setArchiveTargetId("")}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
