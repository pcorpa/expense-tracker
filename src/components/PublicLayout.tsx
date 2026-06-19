import { Suspense } from "react";
import { Link, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/theme";
import { Sun, Moon } from "lucide-react";

export function PublicLayout() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  function toggleLanguage() {
    i18n.changeLanguage(i18n.language === "es" ? "en" : "es");
  }

  return (
    <div className="public-layout">
      <header className="public-header">
        <div className="public-header__inner">
          <Link to="/" className="public-header__logo">
            <div className="logo">E</div>
            <span>{t("nav.brand")}</span>
          </Link>

          <nav className="public-header__nav">
            <Link to="/pricing">{t("nav.pricing")}</Link>
          </nav>

          <div className="public-header__actions">
            <button
              className="nav-control-btn"
              onClick={toggleLanguage}
              title="Toggle language"
            >
              {i18n.language === "es" ? "ES" : "EN"}
            </button>
            <button
              className="nav-control-btn"
              onClick={toggleTheme}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <Link to="/signin" className="public-header__signin">
              {t("auth.signIn")}
            </Link>
            <Link to="/signup" className="button public-header__cta">
              {t("landing.getStarted")}
            </Link>
          </div>
        </div>
      </header>

      <main className="public-content">
        <Suspense fallback={<div className="page page--centered" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
