import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { RecurringExpense, RecurringFrequency } from "../types";

const FIXED_CATEGORIES = [
  "Comida",
  "Limpieza",
  "Salud",
  "Entretenimiento",
  "Hogar",
  "Transporte",
  "Vestimenta",
  "Restaurante",
  "Cuidado Personal",
  "Mascotas",
  "Servicios",
  "Educación",
  "Tecnología",
  "Otro",
];

const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quincenal" },
  { value: "monthly", label: "Mensual" },
  { value: "bimonthly", label: "Bimestral" },
  { value: "quarterly", label: "Trimestral" },
  { value: "every4months", label: "Cada 4 meses" },
  { value: "every6months", label: "Semestral" },
  { value: "annual", label: "Anual" },
];

type DeleteMode = "template_only" | "all" | null;

const ERR: React.CSSProperties = {
  color: "rgba(248,113,113,0.9)",
  fontSize: "0.76rem",
  marginTop: 4,
  display: "block",
};
const INPUT_ERR: React.CSSProperties = {
  outline: "1px solid rgba(248,113,113,0.7)",
};

export function EditRecurringExpense() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [item, setItem] = useState<RecurringExpense | null>(null);
  const [name, setName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("Tecnología");
  const [currency, setCurrency] = useState("UY$");
  const [amount, setAmount] = useState("");
  const [totalPurchaseAmount, setTotalPurchaseAmount] = useState("");
  const [totalInstallments, setTotalInstallments] = useState("");
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user || !id) return;
    supabase
      .from("recurring_expenses")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) {
          navigate("/recurring");
          return;
        }
        setItem(data);
        setName(data.name);
        setVendorName(data.vendor_name ?? "");
        setCategory(data.category);
        setCurrency(data.currency);
        setAmount(data.amount.toString());
        setTotalPurchaseAmount(data.total_purchase_amount?.toString() ?? "");
        setTotalInstallments(data.total_installments?.toString() ?? "");
        setFrequency(data.frequency);
        setStartDate(data.start_date);
        setNotes(data.notes ?? "");
        setLoading(false);
      });
  }, [user, id]);

  const installmentAmount =
    item?.type === "installment" &&
    totalPurchaseAmount &&
    totalInstallments &&
    Number(totalInstallments) >= 2
      ? Number(totalPurchaseAmount) / Number(totalInstallments)
      : null;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (!name.trim()) return;

    const resolvedAmount =
      item?.type === "installment" ? installmentAmount : Number(amount);
    if (!resolvedAmount || resolvedAmount <= 0) return;

    setSaving(true);
    setError(null);

    const payload: any = {
      name: name.trim(),
      vendor_name: vendorName.trim() || null,
      category,
      currency,
      amount: resolvedAmount,
      frequency,
      start_date: startDate,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (item?.type === "installment") {
      payload.total_purchase_amount = Number(totalPurchaseAmount);
      payload.total_installments = Number(totalInstallments);
    }

    const { error: updateError } = await supabase
      .from("recurring_expenses")
      .update(payload)
      .eq("id", id!);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    navigate("/recurring");
  }

  async function handleCancel() {
    setCanceling(true);
    const today = new Date().toISOString().split("T")[0];
    await supabase
      .from("recurring_expenses")
      .update({
        is_active: false,
        end_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id!);
    navigate("/recurring");
  }

  async function handleDelete() {
    if (!deleteMode) return;
    setDeleting(true);

    if (deleteMode === "all") {
      // Delete transaction_items first (no cascade on that FK), then transactions
      const { data: txs } = await supabase
        .from("transactions")
        .select("id")
        .eq("recurring_expense_id", id!);

      if (txs && txs.length > 0) {
        const txIds = txs.map((t: any) => t.id);
        await supabase
          .from("transaction_items")
          .delete()
          .in("transaction_id", txIds);
        await supabase.from("transactions").delete().in("id", txIds);
      }
    }

    await supabase.from("recurring_expenses").delete().eq("id", id!);
    navigate("/recurring");
  }

  const twoColStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  };

  if (loading) {
    return (
      <div className="page">
        <div
          className="skeleton-line"
          style={{ height: 32, width: 240, borderRadius: 8, marginBottom: 24 }}
        />
        <div
          className="skeleton-line"
          style={{ height: 400, borderRadius: 12 }}
        />
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="page">
      <div className="page__header">
        <button
          onClick={() => navigate("/recurring")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "0.85rem",
            marginBottom: 12,
            padding: 0,
            fontFamily: "inherit",
          }}
        >
          <ArrowLeft size={14} />
          Volver
        </button>

        <p className="page__eyebrow">EDITAR RECURRENTE</p>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ marginBottom: 6 }}>{item.name}</h1>
            {item.is_active ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.8rem",
                  color: "var(--color-success)",
                  fontWeight: 500,
                }}
              >
                <span className="active-pulse" />
                Activo
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "#f87171",
                  background: "rgba(248,113,113,0.1)",
                  border: "1px solid rgba(248,113,113,0.2)",
                  padding: "2px 8px",
                  borderRadius: 99,
                  letterSpacing: "0.3px",
                }}
              >
                INACTIVO
              </span>
            )}
          </div>

          {/* Header action buttons */}
          {!showCancelConfirm && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {item.is_active && (
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() => setShowCancelConfirm(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <XCircle size={13} />
                  Cancelar suscripción
                </button>
              )}
              <button
                type="button"
                className="button button--small"
                onClick={() => setShowDeleteDialog(true)}
                style={{
                  background: "rgba(248,113,113,0.12)",
                  color: "#f87171",
                  border: "1px solid rgba(248,113,113,0.25)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Trash2 size={13} />
                Eliminar
              </button>
            </div>
          )}
        </div>

        {/* Inline cancel confirmation */}
        {showCancelConfirm && (
          <div
            style={{
              marginTop: 14,
              padding: "14px 16px",
              borderRadius: 10,
              background: "var(--color-danger-subtle)",
              border: "1px solid rgba(248,113,113,0.25)",
            }}
          >
            <p
              style={{
                fontSize: "0.88rem",
                fontWeight: 600,
                color: "var(--color-danger)",
                marginBottom: 4,
              }}
            >
              ¿Confirmar cancelación?
            </p>
            <p
              style={{
                fontSize: "0.81rem",
                color: "var(--text-secondary)",
                marginBottom: 12,
              }}
            >
              No se generarán nuevas transacciones. Las existentes quedan en el
              registro de gastos normalmente.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="button button--secondary button--small"
                onClick={() => setShowCancelConfirm(false)}
              >
                No, volver
              </button>
              <button
                className="button button--small"
                onClick={handleCancel}
                disabled={canceling}
                style={{
                  background: "rgba(248,113,113,0.15)",
                  color: "#f87171",
                  border: "1px solid rgba(248,113,113,0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {canceling && (
                  <RefreshCw
                    size={12}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                )}
                Sí, cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="content-block">
        <form onSubmit={handleSave} className="form-grid">
          {/* Name + Vendor */}
          <div style={twoColStyle}>
            <label>
              Nombre *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={showErrors && !name.trim() ? INPUT_ERR : {}}
              />
              {showErrors && !name.trim() && (
                <span style={ERR}>Campo requerido</span>
              )}
            </label>
            <label>
              Proveedor / empresa
              <input
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
              />
            </label>
          </div>

          {/* Category + Currency */}
          <div style={twoColStyle}>
            <label>
              Categoría
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {FIXED_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Moneda
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="UY$">UY$ (Pesos)</option>
                <option value="US$">US$ (Dólares)</option>
                <option value="EUR">EUR (Euros)</option>
              </select>
            </label>
          </div>

          {/* Amount — conditional on type */}
          {item.type !== "installment" ? (
            <label>
              Monto por período *
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={
                  showErrors && (!amount || Number(amount) <= 0)
                    ? INPUT_ERR
                    : {}
                }
              />
              {showErrors && (!amount || Number(amount) <= 0) && (
                <span style={ERR}>Ingresá un monto válido</span>
              )}
            </label>
          ) : (
            <>
              <div style={twoColStyle}>
                <label>
                  Monto total de compra *
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={totalPurchaseAmount}
                    onChange={(e) => setTotalPurchaseAmount(e.target.value)}
                  />
                </label>
                <label>
                  Número de cuotas *
                  <input
                    type="number"
                    min="2"
                    max="360"
                    step="1"
                    value={totalInstallments}
                    onChange={(e) => setTotalInstallments(e.target.value)}
                  />
                </label>
              </div>
              {installmentAmount !== null && (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Monto por cuota
                  </span>
                  <span
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      color: "var(--color-accent)",
                      letterSpacing: "-0.2px",
                    }}
                  >
                    {currency}{" "}
                    {installmentAmount.toLocaleString("es-UY", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Frequency + Start date */}
          <div style={twoColStyle}>
            <label>
              Frecuencia
              <select
                value={frequency}
                onChange={(e) =>
                  setFrequency(e.target.value as RecurringFrequency)
                }
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fecha de inicio
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
          </div>

          <label>
            Notas{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              (opcional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>

          {!item.is_active && (
            <div
              style={{
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.2)",
                color: "#f87171",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: "0.85rem",
              }}
            >
              Este gasto recurrente está cancelado o completado. Las
              transacciones pasadas se conservan en el registro.
            </div>
          )}

          {error && (
            <div
              style={{
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.2)",
                color: "#f87171",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: "0.85rem",
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
          >
            <button
              type="button"
              className="button button--secondary"
              onClick={() => navigate("/recurring")}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="button"
              disabled={saving}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              {saving && (
                <RefreshCw
                  size={14}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              )}
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>

      {/* Delete dialog */}
      {showDeleteDialog && (
        <div
          className="delete-dialog-overlay"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="delete-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                marginBottom: 6,
                color: "var(--text-primary)",
              }}
            >
              Eliminar "{item.name}"
            </h2>
            <p
              style={{
                fontSize: "0.87rem",
                color: "var(--text-secondary)",
                marginBottom: 20,
              }}
            >
              ¿Qué querés eliminar?
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}
            >
              {(
                [
                  {
                    value: "template_only" as const,
                    label: "Solo la plantilla",
                    desc: "Las transacciones ya registradas se conservan como gastos normales.",
                    danger: false,
                  },
                  {
                    value: "all" as const,
                    label: "Eliminar todo",
                    desc: "Se elimina la plantilla Y todas las transacciones generadas por este recurrente.",
                    danger: true,
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: `1px solid ${
                      deleteMode === opt.value
                        ? opt.danger
                          ? "rgba(248,113,113,0.5)"
                          : "var(--color-accent)"
                        : "var(--border-strong)"
                    }`,
                    background:
                      deleteMode === opt.value
                        ? opt.danger
                          ? "rgba(248,113,113,0.06)"
                          : "var(--color-accent-subtle)"
                        : "var(--bg-secondary)",
                    cursor: "pointer",
                    transition: "all 0.12s",
                    alignItems: "flex-start",
                  }}
                >
                  <input
                    type="radio"
                    name="deleteMode"
                    value={opt.value}
                    checked={deleteMode === opt.value}
                    onChange={() => setDeleteMode(opt.value)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.88rem",
                        color: opt.danger ? "#f87171" : "var(--text-primary)",
                        marginBottom: 3,
                      }}
                    >
                      {opt.label}
                    </div>
                    <div
                      style={{
                        fontSize: "0.79rem",
                        color: "var(--text-muted)",
                        lineHeight: 1.4,
                      }}
                    >
                      {opt.desc}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                className="button button--secondary button--small"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteMode(null);
                }}
              >
                Cancelar
              </button>
              <button
                className="button button--small"
                onClick={handleDelete}
                disabled={!deleteMode || deleting}
                style={{
                  background: "rgba(248,113,113,0.15)",
                  color: "#f87171",
                  border: "1px solid rgba(248,113,113,0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: !deleteMode ? 0.4 : 1,
                }}
              >
                {deleting && (
                  <RefreshCw
                    size={12}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                )}
                {deleting ? "Eliminando…" : "Confirmar eliminación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
