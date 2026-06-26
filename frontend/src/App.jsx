import { useState, useEffect, useRef } from "react";
import { login, register, uploadFiles } from "./api";

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
  const [mockReports, setMockReports] = useState(initialMockReports);
  const [selectedModel, setSelectedModel] = useState("DeepSeek");
  const [selectedBenchFile, setSelectedBenchFile] = useState(null);
  const [selectedResponseFiles, setSelectedResponseFiles] = useState([]);
  const [showValidation, setShowValidation] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisTaskId, setAnalysisTaskId] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Authentication states
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [user, setUser] = useState(() => localStorage.getItem("username") || "");
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
        setToken(data.token);
        setUser(data.username);
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
        setToken(data.token);
        setUser(data.username);
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
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setToken("");
    setUser("");
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
      alert("Пожалуйста, выберите эталонный файл и файлы ответов перед запуском анализа.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisTaskId("Отправка...");

    try {
      const data = await uploadFiles(selectedBenchFile, selectedResponseFiles, selectedModel);
      
      const serverTaskId = data.task_id || "task_" + Math.random().toString(36).substring(2, 8).toUpperCase();
      setAnalysisTaskId(serverTaskId);

      // Show success alert showing that files were successfully sent and accepted
      alert(data.message || "Файлы успешно отправлены и приняты в обработку!");

      let progress = 0;
      intervalRef.current = setInterval(() => {
        progress += Math.floor(Math.random() * 12) + 6;
        if (progress >= 100) {
          progress = 100;
          setAnalysisProgress(100);
          clearInterval(intervalRef.current);

          // Transition to newly created report detail screen after brief delay
          setTimeout(() => {
            const newReportId = (mockReports.length + 1).toString();
            const cleanBenchName = selectedBenchFile.name.replace(/\.[^/.]+$/, "");
            const cleanResponseName = selectedResponseFiles[0].name.replace(/\.[^/.]+$/, "");
            const courseName = `${cleanBenchName} & ${cleanResponseName}${
              selectedResponseFiles.length > 1 ? ` +${selectedResponseFiles.length - 1}` : ""
            }`;

            const newReport = {
              id: newReportId,
              course: courseName,
              title: "Индивидуальный анализ: " + selectedBenchFile.name,
              errors: [
                { priority: "high", val: "60%", question: "Вопрос q_uploaded_1", text: "Выявлены регулярные ошибки при выходе из циклов и работе со строками. Студенты склонны путать индексацию с 0 и 1." },
                { priority: "medium", val: "35%", question: "Вопрос q_uploaded_2", text: "Обнаружено совпадение структуры решений с эталоном до мелких деталей, возможен плагиат." }
              ],
              recommendations: [
                "Рекомендуется обновить тестовые задачи для снижения риска заучивания.",
                "Провести лекционный разбор темы индексации коллекций."
              ]
            };

            setMockReports((prev) => [...prev, newReport]);
            resetUploadForm();
            window.location.hash = `report-detail-${newReportId}`;
          }, 1000);
        } else {
          setAnalysisProgress(progress);
        }
      }, 250);

    } catch (err) {
      setIsAnalyzing(false);
      alert("Ошибка при отправке файлов: " + err.message);
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
                  <span>⇧</span>
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
                  <span>＋</span>
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
                  style={{ marginTop: "20px", border: 0, width: "100%" }}
                  onClick={startAnalysis}
                >
                  Запустить анализ
                </button>
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
                  <p>api-core подготовил структуру для ai-driver.</p>
                </div>
                <div id="step-3" className={getTimelineStepClass(2, analysisProgress)}>
                  <b>ИИ-агенты анализируют паттерны</b>
                  <p>Статистик проверяет время, методист ищет типовые ошибки.</p>
                </div>
                <div id="step-4" className={getTimelineStepClass(3, analysisProgress)}>
                  <b>Формируется отчёт</b>
                  <p>Excel, JSON и PDF будут готовы после завершения.</p>
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
            <div className="panel" style={{ textAlign: "center", padding: "60px 20px" }}>
              <h2>Отчёт не найден</h2>
              <p className="muted">Пожалуйста, выберите существующий отчёт из истории в левой панели.</p>
            </div>
          </section>
        );
      }

      return (
        <section className="page active" id="report-detail" data-title="Детали отчёта">
          <div className="report-header">
            <div>
              <p className="eyebrow" id="report-course-eyebrow">{report.course}</p>
              <h2 id="report-title-heading">{report.title}</h2>
            </div>
            <div className="export-actions">
              <button type="button" className="secondary-button">Excel</button>
              <button type="button" className="secondary-button">JSON</button>
              <button type="button" className="primary-button">PDF</button>
            </div>
          </div>

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
        </section>
      );
    }

    if (route === "students") {
      return (
        <section className="page active" id="students" data-title="Студенты">
          <div className="panel" style={{ maxWidth: "680px", margin: "40px auto", padding: "30px", borderTop: "4px solid var(--accent-2)" }}>
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "36px" }}>🚧</span>
              <div>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "20px", color: "var(--text)" }}>Модуль «Студенты» находится в разработке</h3>
                <p className="muted" style={{ margin: 0, lineHeight: "1.6" }}>
                  Детальная аналитика по каждому студенту, включая выявление аномального времени прохождения и совпадения текстовых ответов, будет добавлена в ближайших обновлениях системы.
                </p>
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (route === "settings") {
      return (
        <section className="page active" id="settings" data-title="Настройки">
          <div className="panel" style={{ maxWidth: "680px", margin: "40px auto", padding: "30px", borderTop: "4px solid var(--accent-2)" }}>
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "36px" }}>⚙️</span>
              <div>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "20px", color: "var(--text)" }}>Модуль «Настройки» находится в разработке</h3>
                <p className="muted" style={{ margin: 0, lineHeight: "1.6" }}>
                  Настройка параметров интеграции с ИИ-моделями (DeepSeek, GigaChat) и лимитов бюджета на запросы будет доступна в следующей версии кабинета методиста.
                </p>
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (route === "login") {
      return (
        <section className="page auth-page active" id="login" data-title="Авторизация">
          <form className="auth-card" onSubmit={handleLoginSubmit}>
            <p className="eyebrow">Вход</p>
            <h2>Добро пожаловать обратно</h2>
            {authError && <div className="error-box">{authError}</div>}
            <label>
              Email
              <input
                type="email"
                placeholder="name@university.ru"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="primary-button wide"
              style={{ border: 0 }}
            >
              Войти
            </button>
            <a href="#register" onClick={() => setAuthError("")}>Создать аккаунт</a>
          </form>
        </section>
      );
    }

    if (route === "register") {
      return (
        <section className="page auth-page active" id="register" data-title="Регистрация">
          <form className="auth-card" onSubmit={handleRegisterSubmit}>
            <p className="eyebrow">Регистрация</p>
            <h2>Создайте рабочее пространство</h2>
            {authError && <div className="error-box">{authError}</div>}
            <label>
              Имя пользователя
              <input
                type="text"
                placeholder="Ирина"
                value={registerUsername}
                onChange={(e) => setRegisterUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                placeholder="name@university.ru"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                placeholder="Минимум 6 символов"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="primary-button wide"
              style={{ border: 0 }}
            >
              Зарегистрироваться
            </button>
            <a href="#login" onClick={() => setAuthError("")}>Уже есть аккаунт</a>
          </form>
        </section>
      );
    }

    return (
      <section className="page active">
        <div className="panel" style={{ textAlign: "center", padding: "60px 20px" }}>
          <h2>Страница не найдена</h2>
          <a href="#upload" className="primary-button" style={{ marginTop: "20px" }}>Назад на главную</a>
        </div>
      </section>
    );
  };

  const isAuthRoute = route === "login" || route === "register";

  if (isAuthRoute) {
    return (
      <div className="auth-shell">
        {renderActivePage()}
      </div>
    );
  }

  return (
    <div className={`app-shell`}>
      <aside className="sidebar" aria-label="Основная навигация">
        <a className="brand" href="#upload" aria-label="EduCheck AI">
          <span className="brand-mark">E</span>
          <span>
            <strong>EduCheck AI</strong>
            <small>анализ ответов</small>
          </span>
        </a>

        {/* Новый анализ (аналог "Новый чат") */}
        <a
          href="#upload"
          className={`new-chat-btn ${route === "upload" ? "active" : ""}`}
          onClick={() => {
            resetUploadForm();
            window.location.hash = "upload";
          }}
        >
          <span>＋</span> Новый анализ
        </a>

        <div className="sidebar-divider"></div>

        <div className="eyebrow" style={{ paddingLeft: "12px", marginBottom: "8px" }}>История анализов</div>

        {/* Список отчетов в боковой панели (как список диалогов в чате) */}
        <div className="sidebar-history" id="reports-sidebar-list">
          {mockReports.map((report) => (
            <a
              key={report.id}
              href={`#report-detail-${report.id}`}
              className={`history-item ${route === `report-detail-${report.id}` ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = `report-detail-${report.id}`;
              }}
            >
              <span>📄</span> {report.course}
            </a>
          ))}
        </div>

        <div className="sidebar-divider"></div>

        {/* Дополнительные модули внизу */}
        <nav className="nav" style={{ marginTop: "auto", display: "grid", gap: "6px" }}>
          <a
            href="#students"
            className={route === "students" ? "active" : ""}
            style={{ display: "flex", alignItems: "center", gap: "10px" }}
          >
            <span>◫</span> Студенты
          </a>
          <a
            href="#settings"
            className={route === "settings" ? "active" : ""}
            style={{ display: "flex", alignItems: "center", gap: "10px" }}
          >
            <span>⚙</span> Настройки
          </a>
        </nav>

        <div className="sidebar-note">
          <span className="status-dot"></span>
          <p>
            {selectedModel === "DeepSeek" && (
              <>
                DeepSeek активен<br />
                <small>GigaChat готов как резерв</small>
              </>
            )}
            {selectedModel === "GigaChat" && (
              <>
                GigaChat активен<br />
                <small>DeepSeek готов как резерв</small>
              </>
            )}
            {selectedModel === "Qwen_Local" && (
              <>
                Qwen Local активен<br />
                <small>Локальная модель</small>
              </>
            )}
          </p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-label="Открыть меню"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            ☰
          </button>
          <div>
            <p className="eyebrow">Кабинет методиста</p>
            <h1 id="page-title">{getPageTitle(route)}</h1>
          </div>
          <div className="top-actions">
            {token ? (
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--text)" }}>
                  👤 {user}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleLogout}
                  style={{ minHeight: "36px", padding: "6px 12px" }}
                >
                  Выйти
                </button>
              </div>
            ) : (
              <>
                <a className="ghost-button" href="#login" onClick={() => setAuthError("")}>Войти</a>
                <a className="primary-button" href="#register" onClick={() => setAuthError("")}>Регистрация</a>
              </>
            )}
          </div>
        </header>

        {renderActivePage()}
      </main>
    </div>
  );
}

export default App;
