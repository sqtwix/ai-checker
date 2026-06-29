import { useState, useMemo } from "react";
import { ArchiveRestore, ArrowLeft, Construction, Eye, Layers3, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";

export function AuthPage({
  mode,
  authError,
  loginEmail,
  loginPassword,
  registerUsername,
  registerEmail,
  registerPassword,
  onLoginEmailChange,
  onLoginPasswordChange,
  onRegisterUsernameChange,
  onRegisterEmailChange,
  onRegisterPasswordChange,
  onSubmit,
  onClearError,
}) {
  const isLogin = mode === "login";

  return (
    <section className="page auth-page active" id={mode} data-title={isLogin ? "Авторизация" : "Регистрация"}>
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="eyebrow">{isLogin ? "Вход" : "Регистрация"}</p>
        <h2>{isLogin ? "Добро пожаловать обратно" : "Создайте рабочее пространство"}</h2>
        {authError && <div className="error-box">{authError}</div>}

        {!isLogin && (
          <label>
            Имя пользователя
            <input
              type="text"
              placeholder="Ирина"
              value={registerUsername}
              onChange={(e) => onRegisterUsernameChange(e.target.value)}
              required
            />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            placeholder="name@university.ru"
            value={isLogin ? loginEmail : registerEmail}
            onChange={(e) => (isLogin ? onLoginEmailChange(e.target.value) : onRegisterEmailChange(e.target.value))}
            required
          />
        </label>

        <label>
          Пароль
          <input
            type="password"
            placeholder={isLogin ? "Пароль" : "Минимум 6 символов"}
            value={isLogin ? loginPassword : registerPassword}
            onChange={(e) => (isLogin ? onLoginPasswordChange(e.target.value) : onRegisterPasswordChange(e.target.value))}
            required
          />
        </label>

        <button type="submit" className="primary-button wide">
          {isLogin ? "Войти" : "Зарегистрироваться"}
        </button>
        <a href={isLogin ? "#register" : "#login"} onClick={onClearError}>
          {isLogin ? "Создать аккаунт" : "Уже есть аккаунт"}
        </a>
      </form>
    </section>
  );
}

export function ComingSoonPage({ id, title, message }) {
  return (
    <section className="page active" id={id} data-title={title}>
      <div className="state-panel state-panel-compact">
        <span className="state-icon state-icon-warm">
          <Construction size={28} strokeWidth={2.2} />
        </span>
        <h3>Модуль «{title}» находится в разработке</h3>
        <p className="muted">{message}</p>
      </div>
    </section>
  );
}

export function SettingsPage({
  settings,
  onSettingsChange,
  sidebarWidth,
  isSidebarCollapsed,
  onSidebarToggle,
  onSidebarResizeStart,
  archivedReports = [],
  onUnarchiveReport,
}) {
  const [activeGroup, setActiveGroup] = useState("interface");
  const [archiveQuery, setArchiveQuery] = useState("");
  const accessibility = settings.accessibility || {};
  const recommendedAccessibility = {
    fontSize: "xxlarge",
    colorScheme: "dark",
  };
  const filteredArchivedReports = useMemo(() => {
    const query = archiveQuery.trim().toLowerCase();
    if (!query) return archivedReports;

    return archivedReports.filter((report) =>
      `${report.course || ""} ${report.title || ""}`.toLowerCase().includes(query)
    );
  }, [archivedReports, archiveQuery]);

  return (
    <section
      className={`settings-shell ${isSidebarCollapsed ? "settings-sidebar-collapsed" : ""}`}
      id="settings"
      data-title="Настройки"
      style={{ "--settings-sidebar-width": `${sidebarWidth}px` }}
    >
      <header className="settings-topbar">
        <a className="ghost-button settings-back" href="#upload">
          <ArrowLeft size={17} strokeWidth={2.2} />
          Назад
        </a>
        <button
          type="button"
          className="icon-action-button settings-sidebar-toggle"
          aria-label={isSidebarCollapsed ? "Показать панель настроек" : "Скрыть панель настроек"}
          title={isSidebarCollapsed ? "Показать панель настроек" : "Скрыть панель настроек"}
          onClick={onSidebarToggle}
        >
          {isSidebarCollapsed ? (
            <PanelLeftOpen size={18} strokeWidth={2.2} />
          ) : (
            <PanelLeftClose size={18} strokeWidth={2.2} />
          )}
        </button>
      </header>
      <div className="settings-screen">
        <aside className="settings-side" aria-label="Группы настроек">
          <button
            type="button"
            className={`settings-group-button ${activeGroup === "interface" ? "active" : ""}`}
            onClick={() => setActiveGroup("interface")}
          >
            Интерфейс
          </button>
          <button
            type="button"
            className={`settings-group-button ${activeGroup === "archive" ? "active" : ""}`}
            onClick={() => setActiveGroup("archive")}
          >
            Архив
          </button>
          <button
            type="button"
            className="sidebar-resize-handle settings-resize-handle"
            aria-label="Изменить ширину панели настроек"
            onPointerDown={onSidebarResizeStart}
          ></button>
        </aside>

        <div className="settings-content">
          {activeGroup === "interface" ? (
            <>
              <div className="settings-content-heading">
                <h2>Интерфейс</h2>
              </div>

              <section className="panel settings-panel">
                <div className="settings-copy">
                  <Sun size={20} strokeWidth={2.2} />
                  <div>
                    <h3>Тема</h3>
                    <p className="muted">Выберите светлую, темную или системную тему.</p>
                  </div>
                </div>
                <div className="theme-options" role="radiogroup" aria-label="Тема интерфейса">
                  {[
                    { value: "system", label: "Системная", icon: Monitor },
                    { value: "light", label: "Светлая", icon: Sun },
                    { value: "dark", label: "Темная", icon: Moon },
                  ].map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={settings.theme === option.value ? "selected" : ""}
                        role="radio"
                        aria-checked={settings.theme === option.value}
                        onClick={() => onSettingsChange({ theme: option.value })}
                      >
                        <Icon size={17} strokeWidth={2.2} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="panel settings-panel">
                <div className="settings-copy">
                  <Eye size={20} strokeWidth={2.2} />
                  <div>
                    <h3>Режим для слабовидящих</h3>
                    <p className="muted">Включает верхнюю панель для выбора шрифта и контрастной цветовой схемы.</p>
                  </div>
                </div>
                <div className="accessibility-panel">
                  <ToggleSwitch
                    checked={accessibility.enabled}
                    ariaLabel="Режим для слабовидящих"
                    onChange={() =>
                      onSettingsChange({
                        accessibility: accessibility.enabled
                          ? { ...accessibility, enabled: false }
                          : { ...recommendedAccessibility, enabled: true },
                      })
                    }
                  />
                </div>
              </section>

              <section className="panel settings-panel">
                <div className="settings-copy">
                  <Layers3 size={20} strokeWidth={2.2} />
                  <div>
                    <h3>Минимальный интерфейс</h3>
                    <p className="muted">Скрывает вторичные подсказки и декоративные элементы, оставляя рабочие сценарии.</p>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.minimalUi}
                  ariaLabel="Минимальный интерфейс"
                  onChange={() => onSettingsChange({ minimalUi: !settings.minimalUi })}
                />
              </section>
            </>
          ) : (
            <>
              <div className="settings-content-heading">
                <h2>Архив</h2>
              </div>

              <section className="panel archive-panel">
                <p className="muted archive-description">Здесь хранятся отчеты, скрытые из основной истории.</p>

                <label className="archive-search">
                  <Search size={18} strokeWidth={2.2} aria-hidden="true" />
                  <input
                    type="search"
                    value={archiveQuery}
                    onChange={(e) => setArchiveQuery(e.target.value)}
                    placeholder="Найти архивированный отчет"
                    aria-label="Найти архивированный отчет"
                  />
                </label>

                {filteredArchivedReports.length ? (
                  <div className="archive-list">
                    {filteredArchivedReports.map((report) => (
                      <article className="archive-item" key={report.id}>
                        <div>
                          <strong>{report.course}</strong>
                          <p className="muted">{report.title}</p>
                        </div>
                        <button
                          type="button"
                          className="icon-action-button archive-restore-button"
                          onClick={() => onUnarchiveReport?.(report.id)}
                          aria-label={`Разархивировать отчет ${report.course}`}
                          title="Разархивировать"
                        >
                          <ArchiveRestore size={17} strokeWidth={2.2} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="state-panel state-panel-compact archive-empty">
                    <h3>{archiveQuery.trim() ? "Ничего не найдено" : "Архив пуст"}</h3>
                    <p className="muted">
                      {archiveQuery.trim()
                        ? "Попробуйте изменить поисковый запрос."
                        : "Архивированные отчеты появятся здесь."}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ToggleSwitch({ checked, label, ariaLabel, onChange }) {
  return (
    <button
      type="button"
      className={`toggle-switch ${checked ? "checked" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || label}
      onClick={onChange}
    >
      <span className="toggle-track">
        <span className="toggle-thumb"></span>
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

function getReportWordForm(count) {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return "отчетов";
  if (lastDigit === 1) return "отчет";
  if (lastDigit >= 2 && lastDigit <= 4) return "отчета";
  return "отчетов";
}

function getAnswerWordForm(count) {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return "ответов";
  if (lastDigit === 1) return "ответ";
  if (lastDigit >= 2 && lastDigit <= 4) return "ответа";
  return "ответов";
}

function getAnomalyWordForm(count) {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return "аномалий";
  if (lastDigit === 1) return "аномалия";
  if (lastDigit >= 2 && lastDigit <= 4) return "аномалии";
  return "аномалий";
}

function getProblemWordForm(count) {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return "проблемных ответов";
  if (lastDigit === 1) return "проблемный ответ";
  if (lastDigit >= 2 && lastDigit <= 4) return "проблемных ответа";
  return "проблемных ответов";
}

function getRiskPillClass(group) {
  if (group === "Риск") return "risk";
  if (group === "Наблюдение") return "watch";
  return "normal";
}

export function StudentsPage({ reports, onNewAnalysis }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("Все");

  const students = useMemo(() => {
    const studentsMap = {};

    reports.forEach((report) => {
      if (report.status !== "Completed" || !report.result) return;

      const { student_detailed_analyses = [], anomalies = [] } = report.result;

      // Group anomalies by student_id for this report
      const reportAnomaliesMap = {};
      anomalies.forEach((anomaly) => {
        if (!anomaly.student_id) return;
        if (!reportAnomaliesMap[anomaly.student_id]) {
          reportAnomaliesMap[anomaly.student_id] = [];
        }
        reportAnomaliesMap[anomaly.student_id].push(anomaly);
      });

      // Group detailed analyses by student_id for this report
      const reportAnswersMap = {};
      student_detailed_analyses.forEach((detail) => {
        if (!detail.student_id) return;
        if (!reportAnswersMap[detail.student_id]) {
          reportAnswersMap[detail.student_id] = [];
        }
        reportAnswersMap[detail.student_id].push(detail);
      });

      // Collect all student IDs in this report
      const studentIdsInReport = new Set([
        ...Object.keys(reportAnomaliesMap),
        ...Object.keys(reportAnswersMap),
      ]);

      studentIdsInReport.forEach((studentId) => {
        if (!studentsMap[studentId]) {
          studentsMap[studentId] = {
            studentId,
            reportCount: 0,
            totalAnswers: 0,
            scoreSum: 0,
            scoreCount: 0,
            lowScoreCount: 0,
            anomalies: [],
            detailedAnalyses: [],
          };
        }

        const st = studentsMap[studentId];
        st.reportCount += 1;

        const reportAnswers = reportAnswersMap[studentId] || [];
        reportAnswers.forEach((ans) => {
          st.totalAnswers += 1;
          st.scoreSum += ans.ai_score_percent;
          st.scoreCount += 1;
          if (ans.ai_score_percent < 50) {
            st.lowScoreCount += 1;
          }
          st.detailedAnalyses.push(ans);
        });

        const reportAnomalies = reportAnomaliesMap[studentId] || [];
        reportAnomalies.forEach((anom) => {
          st.anomalies.push(anom);
        });
      });
    });

    // Calculate average, risk groups, reasons, and actions
    return Object.values(studentsMap).map((st) => {
      const averageScore = st.scoreCount > 0 ? Math.round(st.scoreSum / st.scoreCount) : 0;

      // Find maximum severity
      let maxSeverity = ""; // "", "Low", "Medium", "High"
      const severityRank = { "": 0, Low: 1, Medium: 2, High: 3 };

      st.anomalies.forEach((anom) => {
        const severity = anom.severity || "";
        if (severityRank[severity] > severityRank[maxSeverity]) {
          maxSeverity = severity;
        }
      });

      // Risk Group logic
      let riskGroup = "Норма";
      if (maxSeverity === "High" || averageScore < 50 || st.lowScoreCount > 1) {
        riskGroup = "Риск";
      } else if (
        maxSeverity === "Medium" ||
        maxSeverity === "Low" ||
        (averageScore >= 50 && averageScore <= 75) ||
        st.lowScoreCount > 0
      ) {
        riskGroup = "Наблюдение";
      }

      // Action logic
      let action = "Без срочных действий";
      if (riskGroup === "Риск") {
        action = "Проверить вручную";
      } else if (riskGroup === "Наблюдение") {
        action = "Наблюдать динамику";
      }

      // Reason logic
      let reason = "Критичных отклонений не найдено.";
      if (st.anomalies.length > 0) {
        // Find the anomaly with max severity
        const sortedAnom = [...st.anomalies].sort((a, b) => {
          return (severityRank[b.severity || ""] || 0) - (severityRank[a.severity || ""] || 0);
        });
        reason = sortedAnom[0].description || "Обнаружена аномалия.";
      } else if (st.lowScoreCount > 0) {
        // Find detailed analysis with the lowest score
        const sortedAnalyses = [...st.detailedAnalyses].sort((a, b) => a.ai_score_percent - b.ai_score_percent);
        reason = sortedAnalyses[0].error_explanation || "Низкий балл за ответ.";
      }

      return {
        studentId: st.studentId,
        reportCount: st.reportCount,
        totalAnswers: st.totalAnswers,
        averageScore,
        lowScoreCount: st.lowScoreCount,
        anomalyCount: st.anomalies.length,
        maxSeverity,
        riskGroup,
        reason,
        action,
      };
    });
  }, [reports]);

  const totalCount = students.length;
  const riskCount = students.filter((s) => s.riskGroup === "Риск").length;
  const watchCount = students.filter((s) => s.riskGroup === "Наблюдение").length;
  const normalCount = students.filter((s) => s.riskGroup === "Норма").length;

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      // Apply search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (!student.studentId.toLowerCase().includes(q)) {
          return false;
        }
      }

      // Apply tab filter
      if (activeTab !== "Все") {
        if (student.riskGroup !== activeTab) {
          return false;
        }
      }

      return true;
    });
  }, [students, searchQuery, activeTab]);

  return (
    <section className="page active" id="students" data-title="Студенты">
      <section className="panel students-intro">
        <div>
          <p className="eyebrow">Аналитика по студентам</p>
          <h2>Группы риска по студентам</h2>
          <p className="muted">
            Сводка построена по завершённым анализам из истории. Студенты объединены по идентификатору
            и распределены по уровню внимания для методиста.
          </p>
        </div>
        <span className="badge">По всей истории</span>
      </section>

      {/* Conditional Rendering based on state */}
      {reports.length === 0 ? (
        <section className="state-panel">
          <h2>Пока нет данных по студентам</h2>
          <p className="muted">
            Запустите анализ, чтобы система собрала студентов из отчётов и распределила их по группам риска.
          </p>
          <button className="primary-button state-action" type="button" onClick={onNewAnalysis}>
            Новый анализ
          </button>
        </section>
      ) : students.length === 0 ? (
        <section className="state-panel">
          <h2>Детализация недоступна</h2>
          <p className="muted">
            В завершённых отчётах нет детализации по студентам.
          </p>
          <button className="primary-button state-action" type="button" onClick={onNewAnalysis}>
            Новый анализ
          </button>
        </section>
      ) : (
        <>
          <section className="metrics-grid" aria-label="Сводка по группам риска">
            <button
              type="button"
              className={`metric-card ${activeTab === "Все" ? "selected" : ""}`}
              onClick={() => setActiveTab("Все")}
              aria-pressed={activeTab === "Все"}
            >
              <span>Всего студентов</span>
              <strong>{totalCount}</strong>
              <small>найдено в отчётах</small>
            </button>
            <button
              type="button"
              className={`metric-card risk ${activeTab === "Риск" ? "selected" : ""}`}
              onClick={() => setActiveTab("Риск")}
              aria-pressed={activeTab === "Риск"}
            >
              <span>Риск</span>
              <strong>{riskCount}</strong>
              <small>требуют проверки</small>
            </button>
            <button
              type="button"
              className={`metric-card watch ${activeTab === "Наблюдение" ? "selected" : ""}`}
              onClick={() => setActiveTab("Наблюдение")}
              aria-pressed={activeTab === "Наблюдение"}
            >
              <span>Наблюдение</span>
              <strong>{watchCount}</strong>
              <small>есть отклонения</small>
            </button>
            <button
              type="button"
              className={`metric-card normal ${activeTab === "Норма" ? "selected" : ""}`}
              onClick={() => setActiveTab("Норма")}
              aria-pressed={activeTab === "Норма"}
            >
              <span>Норма</span>
              <strong>{normalCount}</strong>
              <small>без срочных действий</small>
            </button>
          </section>

          <section className="panel controls-panel" aria-label="Поиск студентов">
            <label className="control-search">
              <Search size={18} strokeWidth={2.2} aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Найти student_id"
              />
            </label>
          </section>

          <section className="students-list" aria-label="Список студентов">
            {filteredStudents.length === 0 ? (
              <section className="state-panel students-empty">
                <h2>{searchQuery.trim() ? "Студент не найден" : "В этой группе пока нет студентов"}</h2>
                <p className="muted">
                  {searchQuery.trim()
                    ? "Попробуйте изменить запрос поиска."
                    : "Студенты с таким уровнем риска отсутствуют в текущих отчетах."}
                </p>
              </section>
            ) : (
              filteredStudents.map((st) => (
                <article className="student-card" key={st.studentId}>
                  <div className="student-id">
                    <strong>{st.studentId}</strong>
                    <small>
                      {st.reportCount} {getReportWordForm(st.reportCount)} · {st.totalAnswers} {getAnswerWordForm(st.totalAnswers)}
                    </small>
                    <span className={`risk-pill ${getRiskPillClass(st.riskGroup)}`}>
                      {st.riskGroup}
                    </span>
                  </div>
                  <div>
                    <h3>Метрики</h3>
                    <div className="student-metrics">
                      <span><b>{st.averageScore}%</b> средний балл</span>
                      <span><b>{st.anomalyCount}</b> {getAnomalyWordForm(st.anomalyCount)}</span>
                      <span><b>{st.lowScoreCount}</b> {getProblemWordForm(st.lowScoreCount)}</span>
                    </div>
                  </div>
                  <div className="reason-block">
                    <h3>Почему попал в группу</h3>
                    <p className="reason-text" title={st.reason}>
                      {st.reason}
                    </p>
                  </div>
                  <div className="action-card">
                    <small>Действие</small>
                    <strong>{st.action}</strong>
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </section>
  );
}
