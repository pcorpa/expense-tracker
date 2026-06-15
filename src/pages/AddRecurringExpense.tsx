import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Info } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  generateDueTransactions,
  countRetroactivePeriods,
  computeInitialLastGeneratedDate,
} from "../lib/recurringExpenses";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Group, RecurringExpenseType, RecurringFrequency } from "../types";

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

const TYPE_OPTIONS: {
  value: RecurringExpenseType;
  emoji: string;
  label: string;
  desc: string;
}[] = [
  {
    value: "subscription",
    emoji: "♻️",
    label: "Suscripción",
    desc: "Monto fijo periódico",
  },
  {
    value: "installment",
    emoji: "💳",
    label: "Cuotas",
    desc: "Compra en financiación",
  },
  {
    value: "periodic_bill",
    emoji: "⚡",
    label: "Gasto Fijo",
    desc: "Servicios periódicos",
  },
];

const ERR: React.CSSProperties = {
  color: "rgba(248,113,113,0.9)",
  fontSize: "0.76rem",
  marginTop: 4,
  display: "block",
};
const INPUT_ERR: React.CSSProperties = {
  outline: "1px solid rgba(248,113,113,0.7)",
};

export function AddRecurringExpense() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [type, setType] = useState<RecurringExpenseType>("subscription");
  const [name, setName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("Tecnología");
  const [customCategory, setCustomCategory] = useState("");
  const [currency, setCurrency] = useState("UY$");
  const [amount, setAmount] = useState("");
  const [totalPurchaseAmount, setTotalPurchaseAmount] = useState("");
  const [totalInstallments, setTotalInstallments] = useState("");
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");
  const [paidInstallments, setPaidInstallments] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("group_members")
      .select("group_id, groups(id, name)")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const gs = (data ?? [])
          .map((m: any) => m.groups)
          .filter(Boolean) as Group[];
        setGroups(gs);
        if (gs.length > 0) setGroupId(gs[0].id);
      });
  }, [user]);

  const installmentAmount =
    type === "installment" &&
    totalPurchaseAmount &&
    totalInstallments &&
    Number(totalInstallments) > 0
      ? Number(totalPurchaseAmount) / Number(totalInstallments)
      : null;

  const retroCount = countRetroactivePeriods(
    startDate,
    frequency,
    type === "installment" && totalInstallments
      ? Number(totalInstallments)
      : undefined
  );
  const effectiveRetroCount = Math.max(0, retroCount - paidInstallments);
  const showRetroNote = retroCount > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);

    const isInstallment = type === "installment";
    const resolvedAmount = isInstallment ? installmentAmount : Number(amount);

    if (!name.trim() || !groupId || !resolvedAmount || resolvedAmount <= 0) return;
    if (
      isInstallment &&
      (!totalPurchaseAmount ||
        Number(totalPurchaseAmount) <= 0 ||
        !totalInstallments ||
        Number(totalInstallments) < 2)
    )
      return;
    if (isInstallment && paidInstallments >= Number(totalInstallments)) return;

    const needsConfirmation = paidInstallments > 0 || effectiveRetroCount > 0;
    if (needsConfirmation) {
      setShowConfirmModal(true);
    } else {
      await doSave();
    }
  }

  async function doSave() {
    setShowConfirmModal(false);
    setLoading(true);
    setError(null);

    const isInstallment = type === "installment";
    const resolvedAmount = isInstallment ? installmentAmount : Number(amount);

    const payload: any = {
      group_id: groupId,
      user_id: user!.id,
      name: name.trim(),
      vendor_name: vendorName.trim() || null,
      type,
      category: category === "Otro" ? customCategory.trim() || "Otro" : category,
      currency,
      amount: resolvedAmount,
      frequency,
      start_date: startDate,
      notes: notes.trim() || null,
    };

    if (isInstallment) {
      payload.total_purchase_amount = Number(totalPurchaseAmount);
      payload.total_installments = Number(totalInstallments);
      if (paidInstallments > 0) {
        payload.last_generated_date = computeInitialLastGeneratedDate(
          startDate,
          frequency,
          paidInstallments
        );
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("recurring_expenses")
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    await generateDueTransactions(inserted, supabase, new Date());
    navigate("/recurring");
  }

  const twoColStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  };

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
        <p className="page__eyebrow">NUEVO RECURRENTE</p>
        <h1>Agregar gasto recurrente</h1>
        <p className="page__desc">
          Suscripciones, cuotas en financiación o gastos periódicos fijos
        </p>
      </div>

      <div className="content-block">
        <form onSubmit={handleSubmit} className="form-grid">
          {/* Type selector */}
          <div>
            <label
              style={{
                display: "block",
                marginBottom: 10,
                fontWeight: 500,
                fontSize: "0.79rem",
                color: "var(--text-muted)",
                letterSpacing: "0.2px",
              }}
            >
              Tipo de gasto
            </label>
            <div className="recurring-type-grid">
              {TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`recurring-type-tile${type === opt.value ? " recurring-type-tile--active" : ""}`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={opt.value}
                    checked={type === opt.value}
                    onChange={() => setType(opt.value)}
                    style={{
                      position: "absolute",
                      opacity: 0,
                      pointerEvents: "none",
                    }}
                  />
                  <span style={{ fontSize: "1.3rem", marginBottom: 7 }}>
                    {opt.emoji}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: "0.88rem",
                      color:
                        type === opt.value
                          ? "var(--color-accent)"
                          : "var(--text-primary)",
                      marginBottom: 3,
                    }}
                  >
                    {opt.label}
                  </span>
                  <span
                    style={{
                      fontSize: "0.74rem",
                      color: "var(--text-muted)",
                      lineHeight: 1.3,
                    }}
                  >
                    {opt.desc}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Group — only shown if user has multiple groups */}
          {groups.length > 1 && (
            <label>
              Grupo
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Name + Vendor */}
          <div style={twoColStyle}>
            <label>
              Nombre *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Netflix, Préstamo auto…"
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
                placeholder="Ej: Netflix, UTE…"
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
            {category === "Otro" && (
              <label style={{ gridColumn: "1 / -1" }}>
                Nombre de categoría
                <input
                  type="text"
                  placeholder="Ej: Médico, Deporte, Mascotas…"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  autoFocus
                />
              </label>
            )}
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
          {type !== "installment" ? (
            <div>
              <label>
                Monto por período *
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
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
              {type === "periodic_bill" && (
                <p className="recurring-retro-note" style={{ marginTop: 8 }}>
                  <Info size={12} style={{ flexShrink: 0 }} />
                  Este monto se usará como referencia. Podés ajustar cada
                  transacción si el valor varía.
                </p>
              )}
            </div>
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
                    placeholder="0.00"
                    style={
                      showErrors &&
                      (!totalPurchaseAmount ||
                        Number(totalPurchaseAmount) <= 0)
                        ? INPUT_ERR
                        : {}
                    }
                  />
                  {showErrors &&
                    (!totalPurchaseAmount ||
                      Number(totalPurchaseAmount) <= 0) && (
                      <span style={ERR}>Campo requerido</span>
                    )}
                </label>
                <label>
                  Número de cuotas *
                  <input
                    type="number"
                    min="2"
                    max="360"
                    step="1"
                    value={totalInstallments}
                    onChange={(e) => {
                      setTotalInstallments(e.target.value);
                      if (paidInstallments >= Number(e.target.value)) setPaidInstallments(0);
                    }}
                    placeholder="Ej: 12"
                    style={
                      showErrors &&
                      (!totalInstallments || Number(totalInstallments) < 2)
                        ? INPUT_ERR
                        : {}
                    }
                  />
                  {showErrors &&
                    (!totalInstallments ||
                      Number(totalInstallments) < 2) && (
                      <span style={ERR}>Mínimo 2 cuotas</span>
                    )}
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

              {Number(totalInstallments) >= 2 && (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <label
                    htmlFor="paid-installments"
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                      flexShrink: 0,
                      margin: 0,
                      cursor: "pointer",
                    }}
                  >
                    Cuotas ya pagadas
                  </label>
                  <input
                    id="paid-installments"
                    type="number"
                    min={0}
                    max={Number(totalInstallments) - 1}
                    step={1}
                    value={paidInstallments}
                    onChange={(e) =>
                      setPaidInstallments(
                        Math.max(
                          0,
                          Math.min(
                            Math.floor(Number(e.target.value)),
                            Number(totalInstallments) - 1
                          )
                        )
                      )
                    }
                    style={{ width: 72, textAlign: "center" }}
                  />
                  <span
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
                  >
                    de {totalInstallments} cuotas
                  </span>
                  {paidInstallments > 0 && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "0.78rem",
                        color: "var(--color-accent)",
                        background: "rgba(99,102,241,0.12)",
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      Próxima: cuota {paidInstallments + 1}
                    </span>
                  )}
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

          {showRetroNote && (
            <p className="recurring-retro-note">
              <Info size={12} style={{ flexShrink: 0 }} />
              {paidInstallments > 0 && effectiveRetroCount === 0 ? (
                <>
                  Las{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>
                    {retroCount} cuotas retroactivas
                  </strong>{" "}
                  quedan cubiertas por las cuotas ya pagadas. No se generarán
                  transacciones retroactivas.
                </>
              ) : paidInstallments > 0 ? (
                <>
                  Se generarán{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>
                    {effectiveRetroCount} transacciones retroactivas
                  </strong>{" "}
                  al guardar ({paidInstallments} cuotas ya pagadas se omitirán).
                </>
              ) : (
                <>
                  Se generarán{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>
                    {retroCount} transacciones retroactivas
                  </strong>{" "}
                  al guardar.
                </>
              )}
            </p>
          )}

          {/* Notes */}
          <label>
            Notas{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              (opcional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Cualquier detalle adicional…"
            />
          </label>

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
              disabled={loading}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              {loading && (
                <RefreshCw
                  size={14}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              )}
              {loading ? "Guardando…" : "Guardar recurrente"}
            </button>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={showConfirmModal}
        title="Confirmar gasto recurrente"
        confirmLabel="Guardar"
        onCancel={() => setShowConfirmModal(false)}
        onConfirm={doSave}
        loading={loading}
      >
        {paidInstallments > 0 && (
          <p style={{ margin: "0 0 10px" }}>
            Las cuotas <strong>1–{paidInstallments}</strong> no serán
            registradas. La generación comenzará desde la{" "}
            <strong>cuota {paidInstallments + 1}</strong>.
          </p>
        )}
        {effectiveRetroCount > 0 && (
          <p style={{ margin: 0 }}>
            Se crearán{" "}
            <strong>{effectiveRetroCount} transacciones retroactivas</strong>{" "}
            desde {startDate}.
          </p>
        )}
        {effectiveRetroCount === 0 && paidInstallments > 0 && retroCount > 0 && (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.83rem" }}>
            No se generarán transacciones retroactivas (cubiertas por las cuotas
            ya pagadas).
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
