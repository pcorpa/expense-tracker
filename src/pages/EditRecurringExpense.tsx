import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { RecurringExpense, RecurringFrequency } from "../types";
import { ConfirmModal } from "../components/ConfirmModal";
import { countPaidInstallments, computeInitialLastGeneratedDate } from "../lib/recurringExpenses";

const FIXED_CATEGORIES: { value: string; i18nKey: string }[] = [
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
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "every4months",
  "every6months",
  "annual",
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
  const { t } = useTranslation();

  const CANCEL_LABEL: Record<string, string> = {
    subscription: t("recurring.cancelSubscription"),
    installment: t("recurring.cancelInstallments"),
    periodic_bill: t("recurring.cancelBill"),
  };

  const CANCEL_BODY: Record<string, string> = {
    subscription: t("recurring.cancelBodySubscription"),
    installment: t("recurring.cancelBodyInstallment"),
    periodic_bill: t("recurring.cancelBodyPeriodicBill"),
  };

  const FREQUENCIES = FREQUENCY_VALUES.map((v) => ({
    value: v,
    label: t(`frequencies.${v}`),
  }));

  const [item, setItem] = useState<RecurringExpense | null>(null);
  const [name, setName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("Tecnología");
  const [customCategory, setCustomCategory] = useState("");
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [currentInstallment, setCurrentInstallment] = useState(0);

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
        if (FIXED_CATEGORIES.some((c) => c.value === data.category)) {
          setCategory(data.category);
        } else {
          setCategory("Otro");
          setCustomCategory(data.category);
        }
        setCurrency(data.currency);
        setAmount(data.amount.toString());
        setTotalPurchaseAmount(data.total_purchase_amount?.toString() ?? "");
        setTotalInstallments(data.total_installments?.toString() ?? "");
        setFrequency(data.frequency);
        setStartDate(data.start_date);
        setNotes(data.notes ?? "");
        if (data.type === "installment") {
          setCurrentInstallment(countPaidInstallments(data));
        }
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

    setShowConfirmModal(true);
  }

  async function doSave() {
    setShowConfirmModal(false);
    setSaving(true);
    setError(null);

    const resolvedAmount =
      item?.type === "installment" ? installmentAmount : Number(amount);

    const payload: any = {
      name: name.trim(),
      vendor_name: vendorName.trim() || null,
      category: category === "Otro" ? customCategory.trim() || "Otro" : category,
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

    const originalPaid = item?.type === "installment" ? countPaidInstallments(item) : 0;
    const installmentChanged = item?.type === "installment" && currentInstallment !== originalPaid;

    if (installmentChanged) {
      payload.last_generated_date =
        currentInstallment === 0
          ? null
          : computeInitialLastGeneratedDate(startDate, frequency, currentInstallment);
    }

    if (installmentChanged && currentInstallment < originalPaid) {
      const { data: txsToDelete } = await supabase
        .from("transactions")
        .select("id")
        .eq("recurring_expense_id", id!)
        .gt("installment_number", currentInstallment);

      if (txsToDelete && txsToDelete.length > 0) {
        const txIds = txsToDelete.map((tx: any) => tx.id);
        await supabase.from("transaction_items").delete().in("transaction_id", txIds);
        await supabase.from("transactions").delete().in("id", txIds);
      }
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
      const { data: txs } = await supabase
        .from("transactions")
        .select("id")
        .eq("recurring_expense_id", id!);

      if (txs && txs.length > 0) {
        const txIds = txs.map((tx: any) => tx.id);
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
          {t("common.back")}
        </button>

        <p className="page__eyebrow">{t("recurring.editEyebrow")}</p>

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
                {t("recurring.active")}
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
                {t("recurring.inactive")}
              </span>
            )}
          </div>

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
                  {CANCEL_LABEL[item.type] ?? t("common.cancel")}
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
                {t("common.delete")}
              </button>
            </div>
          )}
        </div>

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
              {t("recurring.confirmCancelTitle")}
            </p>
            <p
              style={{
                fontSize: "0.81rem",
                color: "var(--text-secondary)",
                marginBottom: 12,
              }}
            >
              {CANCEL_BODY[item.type] ?? t("recurring.confirmCancelText")}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="button button--secondary button--small"
                onClick={() => setShowCancelConfirm(false)}
              >
                {t("recurring.cancelNo")}
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
                {t("recurring.cancelYes")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="content-block">
        <form onSubmit={handleSave} className="form-grid">
          <div style={twoColStyle}>
            <label>
              {t("recurring.nameLabel")} *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              />
            </label>
          </div>

          <div style={twoColStyle}>
            <label>
              {t("recurring.categoryLabel")}
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
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  autoFocus
                />
              </label>
            )}
            <label>
              {t("recurring.currencyLabel")}
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

          {item.type !== "installment" ? (
            <label>
              {t("recurring.amountPerPeriod")} *
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
                <span style={ERR}>{t("recurring.invalidAmount")}</span>
              )}
            </label>
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
                  />
                </label>
                <label>
                  {t("recurring.numInstallmentsLabel")} *
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
                    htmlFor="current-installment"
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                      flexShrink: 0,
                      margin: 0,
                      cursor: "pointer",
                    }}
                  >
                    {t("recurring.currentInstallmentLabel")}
                  </label>
                  <input
                    id="current-installment"
                    type="number"
                    min={0}
                    max={Number(totalInstallments) - 1}
                    step={1}
                    value={currentInstallment}
                    onChange={(e) =>
                      setCurrentInstallment(
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
                    {t("recurring.ofInstallments", { total: totalInstallments })}
                  </span>
                  {currentInstallment !== countPaidInstallments(item) && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "0.78rem",
                        color:
                          currentInstallment > countPaidInstallments(item)
                            ? "var(--color-accent)"
                            : "#f59e0b",
                        background:
                          currentInstallment > countPaidInstallments(item)
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(245,158,11,0.12)",
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {currentInstallment > countPaidInstallments(item)
                        ? t("recurring.installmentsSkipped", {
                            count: currentInstallment - countPaidInstallments(item),
                          })
                        : t("recurring.installmentsDeleted", {
                            count: countPaidInstallments(item) - currentInstallment,
                          })}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          <div style={twoColStyle}>
            <label>
              {t("recurring.frequencyLabel")}
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

          <label>
            {t("recurring.notesLabel")}{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              {t("recurring.notesOptional")}
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
              {t("recurring.inactiveWarning")}
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
              {t("common.cancel")}
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
              {saving ? t("recurring.saving") : t("recurring.saveChanges")}
            </button>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={showConfirmModal}
        title={t("recurring.saveChanges")}
        confirmLabel={t("recurring.saveChanges")}
        onCancel={() => setShowConfirmModal(false)}
        onConfirm={doSave}
        loading={saving}
      >
        {item?.type === "installment" && currentInstallment !== countPaidInstallments(item) ? (
          <>
            {currentInstallment > countPaidInstallments(item) ? (
              <p style={{ margin: "0 0 10px" }}>
                {t("recurring.confirmInstallmentSkip", {
                  from: countPaidInstallments(item),
                  to: currentInstallment,
                  rangeStart: countPaidInstallments(item) + 1,
                  rangeEnd: currentInstallment,
                })}
              </p>
            ) : (
              <p style={{ margin: "0 0 10px" }}>
                {t("recurring.confirmInstallmentBack", {
                  from: countPaidInstallments(item),
                  to: currentInstallment,
                  rangeStart: currentInstallment + 1,
                  rangeEnd: countPaidInstallments(item),
                })}
              </p>
            )}
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.83rem" }}>
              {t("recurring.confirmChangesApplyNext")}
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 10px" }}>
              {t("recurring.confirmChangesOnlyNext")}
            </p>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.83rem" }}>
              {t("recurring.confirmChangesNoModify")}
            </p>
          </>
        )}
      </ConfirmModal>

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
              {t("recurring.deleteTitle", { name: item.name })}
            </h2>
            <p
              style={{
                fontSize: "0.87rem",
                color: "var(--text-secondary)",
                marginBottom: 20,
              }}
            >
              {t("recurring.deleteQuestion")}
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}
            >
              {(
                [
                  {
                    value: "template_only" as const,
                    label: t("recurring.templateOnly"),
                    desc: t("recurring.templateOnlyDesc"),
                    danger: false,
                  },
                  {
                    value: "all" as const,
                    label: t("recurring.deleteAll"),
                    desc: t("recurring.deleteAllDesc"),
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
                    style={{ marginTop: 2, flexShrink: 0, width: "auto", display: "inline-block" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                {t("common.cancel")}
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
                {deleting ? t("recurring.deleting") : t("recurring.confirmDeleteBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
