import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTranslation } from "react-i18next";

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return <div className="page page--centered">{t("common.loading")}</div>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return children;
}
