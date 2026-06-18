import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { usePendingAuditCount } from "../lib/usePendingAuditCount";
import { usePendingInvitationsCount } from "../lib/usePendingInvitationsCount";
import { usePendingVendorCount } from "../lib/usePendingVendorCount";
import {
  LogOut,
  Home as HomeIcon,
  Upload,
  Users,
  ClipboardList,
  CheckCircle2,
  User,
  Image,
  BarChart2,
  ShieldCheck,
  Mail,
  Store,
  Repeat,
  ShoppingCart,
  Sun,
  Moon,
} from "lucide-react";

export function NavBar() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { data: pendingCount = 0 } = usePendingAuditCount();
  const { data: invitationsCount = 0 } = usePendingInvitationsCount();
  const { data: vendorCount = 0 } = usePendingVendorCount();

  const links = [
    { to: "/dashboard", label: t("nav.home"), icon: HomeIcon },
    { to: "/entry", label: t("nav.newEntry"), icon: Upload },
    { to: "/upload", label: t("nav.uploadReceipt"), icon: Image },
    { to: "/transactions", label: t("nav.transactions"), icon: ClipboardList },
    { to: "/review", label: t("nav.review"), icon: CheckCircle2 },
    { to: "/recurring", label: t("nav.recurring"), icon: Repeat },
    { to: "/shopping-list", label: t("nav.shoppingList"), icon: ShoppingCart },
    { to: "/analytics", label: t("nav.analytics"), icon: BarChart2 },
    {
      to: "/product-audit",
      label: t("nav.productAudit"),
      icon: ShieldCheck,
      badge: "audit",
    },
    {
      to: "/vendor-audit",
      label: t("nav.vendorAudit"),
      icon: Store,
      badge: "vendor",
    },
    {
      to: "/invitations",
      label: t("nav.invitations"),
      icon: Mail,
      badge: "invitations",
    },
    { to: "/groups", label: t("nav.groups"), icon: Users },
    { to: "/profile", label: t("nav.profile"), icon: User },
  ];

  function toggleLanguage() {
    i18n.changeLanguage(i18n.language === "es" ? "en" : "es");
  }

  return (
    <header className="app-shell__nav">
      <div className="app-shell__brand">
        <div className="logo">E</div>
        <div>
          <p>{t("nav.brand")}</p>
          <span>{t("nav.tagline")}</span>
        </div>
      </div>

      <nav className="app-shell__links">
        {links.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          const count =
            item.badge === "audit"
              ? pendingCount
              : item.badge === "invitations"
                ? invitationsCount
                : item.badge === "vendor"
                  ? vendorCount
                  : 0;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={active ? "active" : ""}
              style={{ position: "relative" }}
            >
              <Icon size={18} />
              {item.label}
              {count > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    background: "#f59e0b",
                    color: "#000",
                    borderRadius: 10,
                    padding: "1px 7px",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    lineHeight: "1.4",
                    minWidth: 18,
                    textAlign: "center",
                  }}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="app-shell__actions">
        <span>{user?.email ?? t("nav.guest")}</span>
        <div className="nav-controls">
          <button
            type="button"
            className="nav-control-btn"
            onClick={toggleTheme}
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button
            type="button"
            className="nav-control-btn"
            onClick={toggleLanguage}
            title="Switch language"
          >
            {i18n.language === "es" ? "ES" : "EN"}
          </button>
        </div>
        <button type="button" onClick={signOut} className="secondary">
          <LogOut size={16} /> {t("nav.signOut")}
        </button>
      </div>
    </header>
  );
}
