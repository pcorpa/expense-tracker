import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="page page--centered">Loading session...</div>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return children;
}
