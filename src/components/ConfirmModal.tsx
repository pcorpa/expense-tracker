import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  children: ReactNode;
}

export function ConfirmModal({
  open,
  title,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  loading = false,
  children,
}: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: 12,
          padding: "28px 28px 24px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: "1rem",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h3>
        <div
          style={{
            fontSize: "0.88rem",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            marginBottom: 24,
          }}
        >
          {children}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            className="button button--secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            className="button"
            onClick={onConfirm}
            disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            {loading && (
              <RefreshCw
                size={14}
                style={{ animation: "spin 1s linear infinite" }}
              />
            )}
            {loading ? "Guardando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
