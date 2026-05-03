import { NavLink } from "react-router-dom";

import { getDashboardPathForUser, getStoredCurrentUser } from "../lib/auth";
import { usePreferences } from "../context/PreferencesContext";

const links = [
  { to: "/", key: "nav.home" },
  { to: "/upload-prescription", key: "nav.upload" },
  { to: "/search", key: "nav.search" },
  { to: "/chat", key: "nav.chat" },
  { to: "/operations", key: "nav.operations" },
];

export default function Header() {
  const { language, setLanguage, theme, setTheme, t, languageOptions, themeOptions } = usePreferences();
  const currentUser = getStoredCurrentUser();
  const authLink = currentUser ? getDashboardPathForUser(currentUser) : "/login";
  const authLabel = currentUser ? "Dashboard" : "Connexion";

  return (
    <header className="site-header pharmigo-header">
      <NavLink to="/" className="pharmigo-brand">
        <img src="/pharmigo-logo.png" alt="PharmiGo" className="pharmigo-brand-image" />
        <div className="pharmigo-brand-copy">
          <strong>{t("brand.name")}</strong>
          <span>Trouvez vos medicaments, gagnez du temps</span>
        </div>
      </NavLink>

      <nav className="site-nav pharmigo-nav" aria-label="Navigation principale">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            {t(link.key)}
          </NavLink>
        ))}
      </nav>

      <div className="pharmigo-header-right">
        <div className="pharmigo-toolbar">
          <button className="pharmigo-icon-button subtle" type="button" aria-label={t("header.notifications")}>
            <span className="pharmigo-badge-dot">3</span>
            <span aria-hidden="true">🧾</span>
          </button>

          <label className="toolbar-select compact-language">
            <span className="sr-only">{t("header.language")}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="theme-toggle-group" aria-label={t("header.theme")}>
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={theme === option.value ? "theme-toggle active" : "theme-toggle"}
                onClick={() => setTheme(option.value)}
              >
                {t(`theme.${option.value}`)}
              </button>
            ))}
          </div>

          <NavLink to={authLink} className="pharmigo-login-button">
            {authLabel}
          </NavLink>
        </div>
      </div>
    </header>
  );
}
