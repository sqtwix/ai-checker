import { ArrowLeft, Construction, Eye, Layers3, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";

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
}) {
  const accessibility = settings.accessibility || {};
  const recommendedAccessibility = {
    fontSize: "xxlarge",
    colorScheme: "dark",
  };

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
          <button type="button" className="settings-group-button active">
            Интерфейс
          </button>
          <button
            type="button"
            className="sidebar-resize-handle settings-resize-handle"
            aria-label="Изменить ширину панели настроек"
            onPointerDown={onSidebarResizeStart}
          ></button>
        </aside>

        <div className="settings-content">
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
