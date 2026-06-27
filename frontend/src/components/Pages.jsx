import { Construction } from "lucide-react";

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
