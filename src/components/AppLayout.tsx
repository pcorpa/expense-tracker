import { Suspense, useEffect, useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { NavBar } from "./NavBar";
import { MobileMenu } from "./MobileMenu";

export function AppLayout() {
  const { user, loading, signOut } = useAuth();
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 800px)");
    const handleResize = () => setIsMobile(mediaQuery.matches);
    handleResize();
    mediaQuery.addEventListener("change", handleResize);
    return () => mediaQuery.removeEventListener("change", handleResize);
  }, []);

  if (loading) {
    return <div className="page page--centered">{t("common.loading")}</div>;
  }

  if (!user) {
    return <Navigate to="/signin" replace />;
  }

  return (
    <div className="app-shell">
      {isMobile ? <MobileMenu user={user} signOut={signOut} /> : <NavBar />}
      <div className="app-shell__content">
        <Suspense fallback={<main className="page" />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
