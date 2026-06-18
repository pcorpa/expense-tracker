import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/theme";
import {
  Home as HomeIcon,
  Plus,
  Users,
  ClipboardList,
  CheckCircle2,
  User as UserIcon,
  LogOut,
  Menu,
  X,
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
import { usePendingAuditCount } from "../lib/usePendingAuditCount";
import { usePendingInvitationsCount } from "../lib/usePendingInvitationsCount";
import { usePendingVendorCount } from "../lib/usePendingVendorCount";

export function MobileMenu({
  user,
  signOut,
}: {
  user: any;
  signOut: () => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const { data: pendingCount = 0 } = usePendingAuditCount();
  const { data: invitationsCount = 0 } = usePendingInvitationsCount();
  const { data: vendorCount = 0 } = usePendingVendorCount();

  const links = [
    { to: "/dashboard", label: t("nav.home"), icon: HomeIcon },
    { to: "/entry", label: t("nav.newEntry"), icon: Plus },
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
    { to: "/profile", label: t("nav.profile"), icon: UserIcon },
  ];

  function toggleLanguage() {
    i18n.changeLanguage(i18n.language === "es" ? "en" : "es");
  }

  const avatarUrl = user?.user_metadata?.avatar_url;
  const displayName =
    user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email;

  return (
    <div className="mobile-nav">
      <div className="mobile-nav__bar">
        <div className="mobile-nav__identity">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile" className="avatar-img" />
          ) : (
            <span className="logo">E</span>
          )}
          <span className="mobile-nav__email">{displayName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {invitationsCount > 0 && (
            <span
              style={{
                background: "#3b82f6",
                color: "#fff",
                borderRadius: 10,
                padding: "2px 8px",
                fontSize: "0.72rem",
                fontWeight: 700,
              }}
            >
              {invitationsCount > 99 ? "99+" : invitationsCount}
            </span>
          )}
          {pendingCount > 0 && (
            <span
              style={{
                background: "#f59e0b",
                color: "#000",
                borderRadius: 10,
                padding: "2px 8px",
                fontSize: "0.72rem",
                fontWeight: 700,
              }}
            >
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
          <button
            type="button"
            className="nav-control-btn"
            onClick={toggleTheme}
            style={{ padding: "5px 8px" }}
            title={theme === "dark" ? "Light" : "Dark"}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            type="button"
            className="nav-control-btn"
            onClick={toggleLanguage}
            style={{ padding: "5px 8px" }}
            title="Switch language"
          >
            {i18n.language === "es" ? "ES" : "EN"}
          </button>
          <button className="mobile-nav__burger" onClick={() => setOpen(true)}>
            <Menu size={28} />
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="mobile-nav__overlay" onClick={() => setOpen(false)} />
          <nav className="mobile-nav__drawer">
            <div className="mobile-nav__drawer-header">
              <button onClick={() => setOpen(false)}>
                <X size={28} />
              </button>
            </div>

            <div className="mobile-nav__links">
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
                    onClick={() => setOpen(false)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      <Icon size={24} /> <span>{item.label}</span>
                    </span>
                    {count > 0 && (
                      <span
                        style={{
                          background: "#f59e0b",
                          color: "#000",
                          borderRadius: 10,
                          padding: "1px 8px",
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        }}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="mobile-nav__footer">
              <button className="mobile-nav__logout" onClick={signOut}>
                <LogOut size={24} /> <span>{t("nav.signOut")}</span>
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
