import { useState, useEffect, useRef } from "react";
import { Clock3, Files, Pencil, Save, Trash2, Upload, XCircle } from "lucide-react";
import {
  login,
  register,
  uploadFiles,
  getAnalysisStatus,
  getAnalysisHistory,
  renameAnalysisReport,
  isOfflineMode,
  seedOfflineReports,
  createOfflineReport,
  updateOfflineReport,
  deleteOfflineReport,
} from "./api";
import { AppLayout } from "./components/Layout";
import { ConfirmDialog, NamingDialog, ToastStack } from "./components/Feedback";
import { AuthPage, ComingSoonPage } from "./components/Pages";
import {
  exportReportToCsv,
  exportReportToJson,
  exportReportToPdf,
  exportReportToXlsx,
} from "./reportExport";

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
    ]
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
    ]
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
    ]
  }
];

function App() {
  const [route, setRoute] = useState(() => {
    return window.location.hash.replace("#", "") || "upload";
  });
  const [mockReports, setMockReports] = useState([]);
  const [selectedModel, setSelectedModel] = useState("DeepSeek");
  const [selectedBenchFile, setSelectedBenchFile] = useState(null);
  const [selectedResponseFiles, setSelectedResponseFiles] = useState([]);
  const [showValidation, setShowValidation] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisTaskId, setAnalysisTaskId] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [toasts, setToasts] = useState([]);
  const [deleteTargetId, setDeleteTargetId] = useState("");

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
  const intervalRef = useRef(null);
  const saveActionsRef = useRef(null);
  const profileActionsRef = useRef(null);

  // Naming & Renaming states
  const [showNamingModal, setShowNamingModal] = useState(false);
  const [namingTaskId, setNamingTaskId] = useState("");
  const [namingValue, setNamingValue] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [isEditingReportContent, setIsEditingReportContent] = useState(false);
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [manualCourse, setManualCourse] = useState("Новый локальный курс");
  const [manualTitle, setManualTitle] = useState("Черновик offline-отчета");

  const notify = (toast) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((currentToasts) => [...currentToasts, { id, type: "info", ...toast }]);
    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((currentToast) => currentToast.id !== id));
    }, toast.duration || 4200);
  };

  const dismissToast = (toastId) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const mapReportFromApi = (apiReport) => {
    const result = apiReport.result || {};
    const mappedErrors = [];
    if (result.test_summaries) {
      result.test_summaries.forEach((ts) => {
        if (ts.critical_mass_errors) {
          ts.critical_mass_errors.forEach((err) => {
            mappedErrors.push({
              priority: err.fail_rate_percent >= 50 ? "high" : "medium",
              val: `${Math.round(err.fail_rate_percent)}%`,
              question: `${ts.test_name}: Вопрос ${err.question_id}`,
              text: `${err.error_pattern_description} (Причина: ${err.methodological_reason})`
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
      title: result.global_course_summary || (apiReport.status === "Processing" ? "Анализ выполняется..." : "Анализ провалился"),
      errors: mappedErrors,
      recommendations: mappedRecommendations,
      status: apiReport.status,
      error: apiReport.error
    };
  };

  const fetchHistory = async () => {
    try {
      const historyData = await getAnalysisHistory();
      if (Array.isArray(historyData)) {
        const mapped = isOfflineMode ? historyData : historyData.map(mapReportFromApi);
        setMockReports(mapped);
      }
    } catch (err) {
      console.error("Failed to fetch analysis history:", err);
    }
  };

  useEffect(() => {
    seedOfflineReports(initialMockReports);
  }, []);

  useEffect(() => {
    if (token) {
      fetchHistory();
    } else {
      setMockReports([]);
    }
  }, [token]);

  useEffect(() => {
    const hasProcessing = mockReports.some(r => r.status === "Processing");
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchHistory();
    }, 4000);

    return () => clearInterval(interval);
  }, [mockReports]);

  // Sync route with window hash and enforce route protection
  useEffect(() => {
    const handleHashChange = () => {
      const newRoute = window.location.hash.replace("#", "") || "upload";
      
      const isAuthRoute = newRoute === "login" || newRoute === "register";
      const hasToken = !!localStorage.getItem("token");

      if (!hasToken && !isAuthRoute) {
        window.location.hash = "login";
      } else if (hasToken && isAuthRoute) {
        window.location.hash = "upload";
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
      window.location.hash = "login";
      setRoute("login");
    } else if (hasToken && isAuthRoute) {
      window.location.hash = "upload";
      setRoute("upload");
    } else {
      setRoute(initialRoute);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Update document title dynamically
  useEffect(() => {
    document.title = "EduCheck AI — личный кабинет";
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
        window.location.hash = "upload";
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
        window.location.hash = "upload";
      } else {
        throw new Error("Неверный формат ответа сервера.");
      }
    } catch (err) {
      setAuthError(err.message || "Ошибка регистрации.");
    }
  };

  const handleLogout = () => {
    setIsProfileMenuOpen(false);
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("userEmail");
    setToken("");
    setUser("");
    setUserEmail("");
    setRoute("login");
    window.location.hash = "login";
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
    return "EduCheck AI";
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

  // Trigger validation banner visibility
  useEffect(() => {
    if (selectedBenchFile && selectedResponseFiles.length > 0) {
      setShowValidation(true);
    } else {
      setShowValidation(false);
    }
  }, [selectedBenchFile, selectedResponseFiles]);

  const resetUploadForm = () => {
    setSelectedBenchFile(null);
    setSelectedResponseFiles([]);
    setShowValidation(false);
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    if (benchInputRef.current) benchInputRef.current.value = "";
    if (responsesInputRef.current) responsesInputRef.current.value = "";
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const startAnalysis = async () => {
    if (!selectedBenchFile || selectedResponseFiles.length === 0) {
      notify({
        type: "warning",
        title: "Не хватает файлов",
        message: "Выберите эталонный файл и файлы ответов перед запуском анализа.",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisTaskId("Отправка...");

    try {
      const data = await uploadFiles(selectedBenchFile, selectedResponseFiles, selectedModel);
      
      const serverTaskId = data.task_id;
      setAnalysisTaskId(serverTaskId);

      // Show success alert showing that files were successfully sent and accepted
      notify({
        type: "success",
        title: "Файлы приняты",
        message: data.message || "Файлы успешно отправлены и приняты в обработку.",
      });

      let progress = 0;
      let hasCompleted = false;

      // Local progress helper that goes slowly up to 90%
      intervalRef.current = setInterval(() => {
        if (!hasCompleted) {
          progress += Math.floor(Math.random() * 4) + 1;
          if (progress > 90) progress = 90;
          setAnalysisProgress(progress);
        }
      }, 1000);

      // Polling function
      const poll = async () => {
        try {
          const statusRes = await getAnalysisStatus(serverTaskId);
          if (statusRes.status === "Completed") {
            hasCompleted = true;
            clearInterval(intervalRef.current);
            setAnalysisProgress(100);

            // Construct new report based on real result from model
            const result = statusRes.result || {};
            const cleanBenchName = selectedBenchFile.name.replace(/\.[^/.]+$/, "");
            const cleanResponseName = selectedResponseFiles[0].name.replace(/\.[^/.]+$/, "");
            const courseName = `${cleanBenchName} & ${cleanResponseName}${
              selectedResponseFiles.length > 1 ? ` +${selectedResponseFiles.length - 1}` : ""
            }`;

            // Map DTO critical mass errors
            const mappedErrors = [];
            if (result.test_summaries) {
              result.test_summaries.forEach((ts) => {
                if (ts.critical_mass_errors) {
                  ts.critical_mass_errors.forEach((err) => {
                    mappedErrors.push({
                      priority: err.fail_rate_percent >= 50 ? "high" : "medium",
                      val: `${Math.round(err.fail_rate_percent)}%`,
                      question: `${ts.test_name}: Вопрос ${err.question_id}`,
                      text: `${err.error_pattern_description} (Причина: ${err.methodological_reason})`
                    });
                  });
                }
              });
            }

            // Map recommendations
            const mappedRecommendations = [];
            if (result.course_recommendations) {
              result.course_recommendations.forEach((rec) => {
                mappedRecommendations.push(`[${rec.priority}] ${rec.target}: ${rec.action_item}`);
              });
            }

            setNamingTaskId(serverTaskId);
            setNamingValue(courseName);
            setShowNamingModal(true);
            resetUploadForm();
          } else if (statusRes.status === "Failed") {
            clearInterval(intervalRef.current);
            setIsAnalyzing(false);
            await fetchHistory();
            notify({
              type: "error",
              title: "Анализ провалился",
              message: statusRes.error || "Неизвестная ошибка на стороне сервера.",
            });
          } else {
            // Processing... Continue polling after timeout
            setTimeout(poll, 3000);
          }
        } catch (err) {
          console.error("Polling error:", err);
          // Retry polling in case of transient network issues
          setTimeout(poll, 3000);
        }
      };

      // Start polling after 2 seconds
      setTimeout(poll, 2000);

    } catch (err) {
      setIsAnalyzing(false);
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
      window.location.hash = `report-detail-${namingTaskId}`;
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
    window.location.hash = `report-detail-${namingTaskId}`;
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
      window.location.hash = `report-detail-${report.id}`;
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

  const handleDeleteReport = async (reportId) => {
    setDeleteTargetId(reportId);
  };

  const confirmDeleteReport = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteOfflineReport(deleteTargetId);
      await fetchHistory();
      setIsEditingReportContent(false);
      setDeleteTargetId("");
      window.location.hash = "upload";
      notify({
        type: "success",
        title: "Отчет удален",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Не удалось удалить отчет",
        message: err.message,
      });
    }
  };

  const handleExportReport = async (report, format) => {
    setIsSaveMenuOpen(false);
    try {
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
      });
    }
  };

  const getTimelineStepClass = (stepIndex, currentProgress) => {
    const thresholds = [0, 25, 50, 75];
    if (currentProgress >= thresholds[stepIndex]) {
      if (currentProgress > thresholds[stepIndex] + 20 || currentProgress === 100) {
        return "done";
      }
      return "active-step";
    }
    return "";
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
                <p className="muted">Поддерживаются CSV и JSON. Если файл пустой или в нём не хватает колонок, система покажет понятную ошибку до запуска ИИ.</p>

                <div
                  className="dropzone"
                  id="bench-dropzone"
                  style={{ cursor: "pointer" }}
                  onClick={() => benchInputRef.current.click()}
                >
                  <span><Upload size={30} strokeWidth={2.2} /></span>
                  <strong id="bench-file-name">{selectedBenchFile ? selectedBenchFile.name : "Эталонный файл"}</strong>
                  <p>Кликните для выбора benchmark.csv или benchmark.json</p>
                  <input
                    type="file"
                    id="bench-input"
                    ref={benchInputRef}
                    style={{ display: "none" }}
                    accept=".csv,.json"
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
                  <p>Кликните для добавления нескольких файлов ответов</p>
                  <input
                    type="file"
                    id="responses-input"
                    ref={responsesInputRef}
                    style={{ display: "none" }}
                    multiple
                    accept=".csv,.json"
                    onChange={(e) => handleFileChange(e, "responses")}
                  />
                </div>
              </section>

              <section className="panel">
                <p className="eyebrow">Параметры</p>
                <h3>Выбор ИИ-модели</h3>
                <label className="field-label">ИИ-модель</label>
                <div className="segmented" id="model-selector-container">
                  <button
                    type="button"
                    className={selectedModel === "DeepSeek" ? "selected" : ""}
                    onClick={() => setSelectedModel("DeepSeek")}
                  >
                    DeepSeek
                  </button>
                  <button
                    type="button"
                    className={selectedModel === "GigaChat" ? "selected" : ""}
                    onClick={() => setSelectedModel("GigaChat")}
                  >
                    GigaChat
                  </button>
                  <button
                    type="button"
                    className={selectedModel === "Qwen_Local" ? "selected" : ""}
                    onClick={() => setSelectedModel("Qwen_Local")}
                  >
                    Qwen Local
                  </button>
                </div>

                {showValidation && (
                  <div className="validation-box" id="upload-validation-box" style={{ marginTop: "20px" }}>
                    <b>Проверка пройдена</b>
                    <p>Колонки распознаны успешно. Формат корректен.</p>
                  </div>
                )}

                <button
                  className="primary-button wide"
                  id="start-analysis-btn"
                  style={{ marginTop: "20px", width: "100%" }}
                  onClick={startAnalysis}
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
            <div className="panel" id="upload-progress-panel" style={{ marginTop: "0" }}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow" id="progress-task-id">Задача {analysisTaskId}</p>
                  <h2>Выполнение анализа</h2>
                </div>
                <span className="badge" id="progress-percentage-badge">{analysisProgress}%</span>
              </div>
              <div className="progress-track">
                <span id="progress-fill-bar" style={{ width: `${analysisProgress}%`, transition: "width 0.4s ease" }}></span>
              </div>
              <div className="timeline" id="progress-timeline-steps">
                <div id="step-1" className={getTimelineStepClass(0, analysisProgress)}>
                  <b>Файлы приняты</b>
                  <p>Эталон и файлы ответов прошли базовую проверку.</p>
                </div>
                <div id="step-2" className={getTimelineStepClass(1, analysisProgress)}>
                  <b>Данные приведены к JSON</b>
                  <p>{isOfflineMode ? "Offline mode подготовил локальную структуру отчета." : "api-core подготовил структуру для ai-driver."}</p>
                </div>
                <div id="step-3" className={getTimelineStepClass(2, analysisProgress)}>
                  <b>ИИ-агенты анализируют паттерны</b>
                  <p>{isOfflineMode ? "Создается шаблонный демо-результат для проверки интерфейса." : "Статистик проверяет время, методист ищет типовые ошибки."}</p>
                </div>
                <div id="step-4" className={getTimelineStepClass(3, analysisProgress)}>
                  <b>Формируется отчёт</b>
                  <p>{isOfflineMode ? "JSON будет доступен локально после завершения." : "Excel, JSON и PDF будут готовы после завершения."}</p>
                </div>
              </div>
            </div>
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

      if (report.status === "Processing") {
        return (
          <section className="page active" id="report-detail" data-title="Детали отчёта">
            <div className="state-panel">
              <span className="state-icon">
                <Clock3 size={28} strokeWidth={2.2} />
              </span>
              <h2>Анализ в процессе...</h2>
              <p className="muted">ИИ-агенты в данный момент обрабатывают файлы ответов студентов. Пожалуйста, подождите.</p>
            </div>
          </section>
        );
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
                <form onSubmit={handleInlineRenameSubmit} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <input
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: "6px",
                      backgroundColor: "var(--bg)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: "14px",
                      minWidth: "240px",
                      outline: "none"
                    }}
                    required
                    autoFocus
                  />
                  <button type="submit" className="primary-button" style={{ padding: "4px 10px", minHeight: "28px", fontSize: "12px" }}>
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setIsEditingTitle(false)}
                    style={{ padding: "4px 10px", minHeight: "28px", fontSize: "12px" }}
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
            </div>
            <div className="export-actions">
              {isOfflineMode && (
                <>
                  <button
                    type="button"
                    className={`icon-action-button edit-action ${isEditingReportContent ? "active" : ""}`}
                    onClick={() => setIsEditingReportContent(!isEditingReportContent)}
                    aria-label={isEditingReportContent ? "Завершить редактирование" : "Редактировать отчет"}
                    title={isEditingReportContent ? "Готово" : "Редактировать"}
                  >
                    <Pencil size={18} strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    className="icon-action-button delete-action"
                    onClick={() => handleDeleteReport(report.id)}
                    aria-label="Удалить"
                    title="Удалить"
                  >
                    <Trash2 size={18} strokeWidth={2.2} />
                  </button>
                </>
              )}
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
                      <button type="button" className="ghost-button" onClick={() => removeRecommendation(report, i)}>
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
                      <button type="button" className="ghost-button" onClick={() => removeFinding(report, i)}>
                        Удалить ошибку
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="grid two">
              <section className="panel">
                <h3>Критичные массовые ошибки</h3>
                <div id="report-errors-container">
                  {report.errors.map((err, i) => (
                    <article key={i} className="finding">
                      <span className={`priority ${err.priority}`}>{err.val}</span>
                      <div>
                        <b>{err.question}</b>
                        <p>{err.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <h3>Рекомендации</h3>
                <ul className="recommendations" id="report-recommendations-list">
                  {report.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </section>
      );
    }

    if (route === "students") {
      return (
        <ComingSoonPage
          id="students"
          title="Студенты"
          message="Здесь будет детальная аналитика по каждому студенту. В этой версии интерфейс оставлен без лишних обещаний и готов к подключению данных."
        />
      );
    }

    if (route === "settings") {
      return (
        <ComingSoonPage
          id="settings"
          title="Настройки"
          message="Параметры интеграций и лимитов появятся отдельной итерацией. Сейчас активные настройки модели доступны на экране загрузки."
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

  const deleteTargetReport = mockReports.find((report) => report.id === deleteTargetId);
  const isAuthRoute = route === "login" || route === "register";

  if (isAuthRoute) {
    return (
      <div className="auth-shell">
        {renderActivePage()}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <>
      <AppLayout
        route={route}
        pageTitle={getPageTitle(route)}
        reports={filteredReports}
        historyQuery={historyQuery}
        onHistoryQueryChange={setHistoryQuery}
        onNewAnalysis={() => {
          resetUploadForm();
          window.location.hash = "upload";
        }}
        selectedModel={selectedModel}
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
        open={!!deleteTargetId}
        title="Удалить отчет?"
        message={`Отчет ${deleteTargetReport ? `«${deleteTargetReport.course}»` : ""} будет удален из локальной истории.`}
        confirmLabel="Удалить"
        onConfirm={confirmDeleteReport}
        onCancel={() => setDeleteTargetId("")}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
