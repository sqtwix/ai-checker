import { FileText, Menu, Plus, Search, Settings, User, Users } from "lucide-react";
import logo from "../assets/logo.png";
import { isOfflineMode } from "../api";

export function AppLayout({
  route,
  pageTitle,
  children,
  reports,
  historyQuery,
  onHistoryQueryChange,
  onNewAnalysis,
  selectedModel,
  token,
  user,
  userEmail,
  isMenuOpen,
  setIsMenuOpen,
  isProfileMenuOpen,
  setIsProfileMenuOpen,
  setIsSaveMenuOpen,
  profileActionsRef,
  onLogout,
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Основная навигация">
        <a className="brand" href="#upload" aria-label="EduCheck AI">
          <img className="brand-logo" src={logo} alt="EduCheck AI" />
          <span>
            <strong>EduCheck AI</strong>
            <small>анализ ответов</small>
          </span>
        </a>

        <a href="#upload" className={`new-chat-btn ${route === "upload" ? "active" : ""}`} onClick={onNewAnalysis}>
          <Plus size={18} strokeWidth={2.2} /> Новый анализ
        </a>

        <div className="sidebar-divider"></div>

        <div className="sidebar-section-title">История анализов</div>
        <label className="sidebar-search">
          <Search size={16} strokeWidth={2.2} />
          <input
            type="search"
            value={historyQuery}
            onChange={(e) => onHistoryQueryChange(e.target.value)}
            placeholder="Найти отчет"
            aria-label="Найти отчет в истории"
          />
        </label>

        <div className="sidebar-history" id="reports-sidebar-list">
          {reports.length ? (
            reports.map((report) => (
              <a
                key={report.id}
                href={`#report-detail-${report.id}`}
                className={`history-item ${route === `report-detail-${report.id}` ? "active" : ""}`}
                title={report.title ? `${report.course}: ${report.title}` : report.course}
                onClick={(e) => {
                  e.preventDefault();
                  window.location.hash = `report-detail-${report.id}`;
                }}
              >
                <FileText size={16} strokeWidth={2.2} />
                <span>{report.course}</span>
              </a>
            ))
          ) : (
            <div className="sidebar-empty">
              {historyQuery ? "Ничего не найдено" : "История пока пуста"}
            </div>
          )}
        </div>

        <div className="sidebar-divider"></div>

        <nav className="nav sidebar-nav">
          <a href="#students" className={route === "students" ? "active" : ""}>
            <Users size={17} strokeWidth={2.2} /> Студенты
          </a>
          <a href="#settings" className={route === "settings" ? "active" : ""}>
            <Settings size={17} strokeWidth={2.2} /> Настройки
          </a>
        </nav>

        <ModelStatus selectedModel={selectedModel} />
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-label="Открыть меню"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <Menu size={20} strokeWidth={2.2} />
          </button>
          <div>
            <p className="eyebrow">Кабинет методиста</p>
            <h1 id="page-title">{pageTitle}</h1>
          </div>
          <div className="top-actions">
            {token ? (
              <div className="profile-actions" ref={profileActionsRef}>
                <button
                  type="button"
                  className="icon-action-button profile-trigger"
                  onClick={() => {
                    setIsSaveMenuOpen(false);
                    setIsProfileMenuOpen((isOpen) => !isOpen);
                  }}
                  aria-expanded={isProfileMenuOpen}
                  aria-haspopup="menu"
                  aria-label={user ? `Профиль: ${user}` : "Профиль"}
                  title={user ? `Профиль: ${user}` : "Профиль"}
                >
                  <User size={18} strokeWidth={2.2} />
                </button>
                {isProfileMenuOpen && (
                  <div className="profile-menu" role="menu">
                    <div className="profile-summary">
                      <span className="profile-summary-icon">
                        <User size={18} strokeWidth={2.2} />
                      </span>
                      <span className="profile-summary-text">
                        <strong>{user || "Пользователь"}</strong>
                        <small>Методист</small>
                        {userEmail && <small>{userEmail}</small>}
                      </span>
                    </div>
                    <button type="button" role="menuitem" onClick={onLogout}>
                      Выйти
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <a className="ghost-button" href="#login">Войти</a>
                <a className="primary-button" href="#register">Регистрация</a>
              </>
            )}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

function ModelStatus({ selectedModel }) {
  const modelText = {
    DeepSeek: ["DeepSeek активен", "GigaChat готов как резерв"],
    GigaChat: ["GigaChat активен", "DeepSeek готов как резерв"],
    Qwen_Local: ["Qwen Local активен", "Локальная модель"],
  }[selectedModel] || ["Модель активна", "Параметры готовы"];

  return (
    <div className="sidebar-note">
      <span className="status-dot"></span>
      <p>
        {isOfflineMode && (
          <>
            Offline mode<br />
            <small>Backend не используется</small><br />
          </>
        )}
        {modelText[0]}<br />
        <small>{modelText[1]}</small>
      </p>
    </div>
  );
}
