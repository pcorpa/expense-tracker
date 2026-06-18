import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, RefreshCw, Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import {
  countRetroactivePeriods,
  computeInitialLastGeneratedDate,
} from "../lib/recurringExpenses";
import { getAllGroups } from "../api/groups";
import { createRecurringExpense } from "../api/recurringExpenses";
import { ConfirmModal } from "../components/ConfirmModal";
import type { RecurringExpenseType, RecurringFrequency } from "../types";

const FIXED_CATEGORIES = [
  { value: "Comida", i18nKey: "categories.comida" },
  { value: "Limpieza", i18nKey: "categories.limpieza" },
  { value: "Salud", i18nKey: "categories.salud" },
  { value: "Entretenimiento", i18nKey: "categories.entretenimiento" },
  { value: "Hogar", i18nKey: "categories.hogar" },
  { value: "Transporte", i18nKey: "categories.transporte" },
  { value: "Vestimenta", i18nKey: "categories.vestimenta" },
  { value: "Restaurante", i18nKey: "categories.restaurante" },
  { value: "Cuidado Personal", i18nKey: "categories.cuidadoPersonal" },
  { value: "Mascotas", i18nKey: "categories.mascotas" },
  { value: "Servicios", i18nKey: "categories.servicios" },
  { value: "Educación", i18nKey: "categories.educacion" },
  { value: "Tecnología", i18nKey: "categories.tecnologia" },
  { value: "Otro", i18nKey: "categories.otro" },
];

const FREQUENCY_VALUES: RecurringFrequency[] = [
  "weekly", "biweekly", "monthly", "bimonthly", "quarterly", "every4months", "every6months", "annual",
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
  const { t } = useTranslation();

  const FREQUENCIES: { value: RecurringFrequency; label: string }[] = FREQUENCY_VALUES.map((v) => ({
    value: v,
    label: t(`frequencies.${v}`),
  }));

  const TYPE_OPTIONS: { value: RecurringExpenseType; emoji: string; label: string; desc: string }[] = [
    { value: "subscription", emoji: "♻️", label: t("recurring.typeSubscription"), desc: t("recurring.typeSubscriptionDesc") },
    { value: "installment", emoji: "💳", label: t("recurring.typeInstallment"), desc: t("recurring.typeInstallmentDesc") },
    { value: "periodic_bill", emoji: "⚡", label: t("recurring.typePeriodicBill"), desc: t("recurring.typePeriodicBillDesc") },
  ];

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

  const { data: allGroups = [] } = useQuery({
    queryKey: ["all-groups"],
    queryFn: getAllGroups,
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (allGroups.length > 0 && !groupId) setGroupId(allGroups[0].id);
  }, [allGroups]);

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

    try {
      await createRecurringExpense(payload);
      navigate("/recurring");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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
          {t("recurring.back")}
        </button>
        <p className="page__eyebrow">{t("recurring.newRecurringEyebrow")}</p>
        <h1>{t("recurring.addTitle")}</h1>
        <p className="page__desc">
          {t("recurring.addSubtitle")}
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
              {t("recurring.expenseType")}
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
          {allGroups.length > 1 && (
            <label>
              {t("recurring.group")}
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                {allGroups.map((g) => (
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
              {t("recurring.nameLabel")} *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Netflix, Préstamo auto…"
                style={showErrors && !name.trim() ? INPUT_ERR : {}}
              />
              {showErrors && !name.trim() && (
                <span style={ERR}>{t("common.required")}</span>
              )}
            </label>
            <label>
              {t("recurring.vendorLabel")}
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
              {t("recurring.category")}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {FIXED_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.i18nKey)}
                  </option>
                ))}
              </select>
            </label>
            {category === "Otro" && (
              <label style={{ gridColumn: "1 / -1" }}>
                {t("recurring.customCategoryLabel")}
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
              {t("entry.currency")}
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="UY$">{t("recurring.currencyPesos")}</option>
                <option value="US$">{t("recurring.currencyDollars")}</option>
                <option value="EUR">{t("recurring.currencyEuros")}</option>
              </select>
            </label>
          </div>

          {/* Amount — conditional on type */}
          {type !== "installment" ? (
            <div>
              <label>
                {t("recurring.amountPerPeriod")} *
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
                  <span style={ERR}>{t("recurring.invalidAmount")}</span>
                )}
              </label>
              {type === "periodic_bill" && (
                <p className="recurring-retro-note" style={{ marginTop: 8 }}>
                  <Info size={12} style={{ flexShrink: 0 }} />
                  {t("recurring.periodicBillInfo")}
                </p>
              )}
            </div>
          ) : (
            <>
              <div style={twoColStyle}>
                <label>
                  {t("recurring.totalPurchaseAmountLabel")} *
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
                      <span style={ERR}>{t("common.required")}</span>
                    )}
                </label>
                <label>
                  {t("recurring.numInstallmentsLabel")} *
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
                      <span style={ERR}>{t("recurring.minInstallments")}</span>
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
                    {t("recurring.installmentAmountLabel")}
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
                    {t("recurring.alreadyPaidLabel")}
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
                    {t("recurring.ofTotal", { total: totalInstallments })}
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
                      {t("recurring.nextInstallment", { num: paidInstallments + 1 })}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {/* Frequency + Start date */}
          <div style={twoColStyle}>
            <label>
              {t("recurring.frequency")}
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
              {t("recurring.startDate")}
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
              {paidInstallments > 0 && effectiveRetroCount === 0
                ? t("recurring.retroCoveredByPaid", { count: retroCount })
                : paidInstallments > 0
                  ? t("recurring.retroWithPaid", { effective: effectiveRetroCount, paid: paidInstallments })
                  : t("recurring.retroNoteSimple", { count: retroCount })}
            </p>
          )}

          {/* Notes */}
          <label>
            {t("recurring.notesLabel")}{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              {t("recurring.notesOptional")}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t("recurring.notesPlaceholder")}
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
              {t("common.cancel")}
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
              {loading ? t("recurring.saving") : t("recurring.saveRecurring")}
            </button>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={showConfirmModal}
        title={t("recurring.confirmRecurringTitle")}
        confirmLabel={t("common.save")}
        onCancel={() => setShowConfirmModal(false)}
        onConfirm={doSave}
        loading={loading}
      >
        {paidInstallments > 0 && (
          <p style={{ margin: "0 0 10px" }}>
            {t("recurring.confirmSkipInstallments", { paid: paidInstallments, next: paidInstallments + 1 })}
          </p>
        )}
        {effectiveRetroCount > 0 && (
          <p style={{ margin: 0 }}>
            {t("recurring.confirmRetroCreation", { count: effectiveRetroCount, date: startDate })}
          </p>
        )}
        {effectiveRetroCount === 0 && paidInstallments > 0 && retroCount > 0 && (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.83rem" }}>
            {t("recurring.confirmNoRetroactive")}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
