import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Repeat,
  Calendar,
  CreditCard,
  Zap,
  Edit2,
  XCircle,
  Trash2,
  Wallet,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { countPaidInstallments } from "../lib/recurringExpenses";
import { getAllGroups } from "../api/groups";
import {
  getRecurringExpenses,
  cancelRecurringExpense,
  generateDueForAll,
} from "../api/recurringExpenses";
import type { RecurringExpense, RecurringFrequency } from "../types";

const FREQ_MONTHLY_MULT: Record<RecurringFrequency, number> = {
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  bimonthly: 0.5,
  quarterly: 0.333,
  every4months: 0.25,
  every6months: 0.167,
  annual: 0.083,
};

function TypeIcon({ type, size = 10 }: { type: string; size?: number }) {
  if (type === "installment") return <CreditCard size={size} />;
  if (type === "periodic_bill") return <Zap size={size} />;
  return <RefreshCw size={size} />;
}

export function RecurringExpenses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  const qc = useQueryClient();

  const { data: allGroups = [] } = useQuery({
    queryKey: ["all-groups"],
    queryFn: getAllGroups,
    enabled: Boolean(user),
  });
  const groupIds = allGroups.map((g) => g.id);

  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ["recurring-expenses", groupIds],
    queryFn: async () => {
      const expenses = await getRecurringExpenses(groupIds);
      const active = expenses.filter((r) => r.is_active);
      if (active.length > 0) {
        await generateDueForAll(active);
        return getRecurringExpenses(groupIds);
      }
      return expenses;
    },
    enabled: groupIds.length > 0,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelRecurringExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-expenses"] });
      setCancelConfirmId(null);
    },
  });

  function handleCancel(id: string) {
    cancelMutation.mutate(id);
  }

  const filtered =
    groupFilter === "all"
      ? items
      : items.filter((r) => r.group_id === groupFilter);

  const active = filtered.filter((r) => r.is_active);
  const inactive = filtered.filter((r) => !r.is_active);

  const TYPE_LABELS: Record<string, string> = {
    subscription: t("recurring.typeSubscription"),
    installment: t("recurring.typeInstallment"),
    periodic_bill: t("recurring.typePeriodicBill"),
  };

  const FREQ_LABELS: Record<RecurringFrequency, string> = {
    weekly: t("frequencies.weekly"),
    biweekly: t("frequencies.biweekly"),
    monthly: t("frequencies.monthly"),
    bimonthly: t("frequencies.bimonthly"),
    quarterly: t("frequencies.quarterly"),
    every4months: t("frequencies.every4months"),
    every6months: t("frequencies.every6months"),
    annual: t("frequencies.annual"),
  };

  const FREQUENT_FREQS = new Set<RecurringFrequency>(["weekly", "biweekly", "monthly"]);

  const nextMonthByCurrency = active
    .filter(r => FREQUENT_FREQS.has(r.frequency))
    .reduce((acc, r) => {
      acc[r.currency] = (acc[r.currency] ?? 0) + r.amount * FREQ_MONTHLY_MULT[r.frequency];
      return acc;
    }, {} as Record<string, number>);

  const reserveByCurrency = active
    .filter(r => !FREQUENT_FREQS.has(r.frequency))
    .reduce((acc, r) => {
      acc[r.currency] = (acc[r.currency] ?? 0) + r.amount * FREQ_MONTHLY_MULT[r.frequency];
      return acc;
    }, {} as Record<string, number>);

  const sortCurrencies = ([a]: [string, number], [b]: [string, number]) =>
    a === "UY$" ? -1 : b === "UY$" ? 1 : a.localeCompare(b);
  const nextMonthEntries = Object.entries(nextMonthByCurrency).sort(sortCurrencies);
  const reserveEntries = Object.entries(reserveByCurrency).sort(sortCurrencies);
  const hasReserve = reserveEntries.length > 0;
  const installmentsInProgress = active.filter(
    (r) => r.type === "installment"
  ).length;

  if (loading) {
    return (
      <div className="page">
        <div
          className="skeleton-line"
          style={{ height: 32, width: 220, borderRadius: 8, marginBottom: 24 }}
        />
        <div
          className="skeleton-line"
          style={{ height: 120, borderRadius: 12 }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <p className="page__eyebrow">{t("recurring.fixedFinances")}</p>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1>{t("recurring.title")}</h1>
            <p className="page__desc">
              {t("recurring.subtitle")}
            </p>
          </div>
          <button
            className="button"
            onClick={() => navigate("/recurring/new")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              flexShrink: 0,
            }}
          >
            <Plus size={15} />
            {t("recurring.newRecurring")}
          </button>
        </div>
      </div>

      {allGroups.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="all">{t("recurring.allGroups")}</option>
            {allGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* KPI row */}
      <div className="recurring-kpi-row">
        <div className="kpi-card">
          <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
            {/* Left: Próximo mes */}
            <div style={{
              flex: 1,
              paddingRight: hasReserve ? 16 : 0,
              borderRight: hasReserve ? "1px solid var(--border-color)" : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                <Calendar size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <p className="kpi-label" style={{ margin: 0 }}>{t("recurring.nextMonth")}</p>
              </div>
              {nextMonthEntries.length === 0 ? (
                <p className="kpi-value">—</p>
              ) : (
                nextMonthEntries.map(([cur, total]) => (
                  <p
                    key={cur}
                    className={`kpi-value${nextMonthEntries.length > 1 ? " kpi-value--sm" : ""}`}
                  >
                    {cur}{" "}
                    {total.toLocaleString("es-UY", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </p>
                ))
              )}
              <p className="kpi-sub">
                {nextMonthEntries.length === 0 ? t("recurring.noFrequent") : t("recurring.monthlyPayments")}
              </p>
            </div>

            {/* Right: Reserva mensual — only shown when infrequent expenses exist */}
            {hasReserve && (
              <div style={{ flex: 1, paddingLeft: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  <Wallet size={12} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
                  <p className="kpi-label" style={{ margin: 0, color: "var(--color-accent)" }}>
                    {t("recurring.monthlyReserve")}
                  </p>
                </div>
                {reserveEntries.map(([cur, total]) => (
                  <p
                    key={cur}
                    className={`kpi-value${reserveEntries.length > 1 ? " kpi-value--sm" : ""}`}
                    style={{ color: "var(--color-accent)" }}
                  >
                    {cur}{" "}
                    {total.toLocaleString("es-UY", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </p>
                ))}
                <p className="kpi-sub">{t("recurring.forInfrequent")}</p>
              </div>
            )}
          </div>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">{t("recurring.activeRecurrents")}</p>
          <p className="kpi-value">{active.length}</p>
          <p className="kpi-sub">{t("recurring.activeSubscriptions")}</p>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">{t("recurring.installmentsInProgressKpi")}</p>
          <p className="kpi-value">{installmentsInProgress}</p>
          <p className="kpi-sub">{t("recurring.activeInstallmentPlans")}</p>
        </div>
      </div>

      {/* Active section */}
      <div className="content-block">
        <div
          className="recurring-section-title"
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}
        >
          <span className="active-pulse" />
          {t("recurring.activeSectionTitle", { count: active.length })}
        </div>

        {active.length === 0 ? (
          <div className="recurring-empty">
            <Repeat
              size={40}
              style={{ opacity: 0.25, display: "block", margin: "0 auto 12px" }}
            />
            <p
              style={{
                fontSize: "0.97rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 6,
              }}
            >
              {t("recurring.noExpensesYet")}
            </p>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                maxWidth: 320,
                margin: "0 auto 20px",
              }}
            >
              {t("recurring.noExpensesYetDesc")}
            </p>
            <button
              className="button"
              onClick={() => navigate("/recurring/new")}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <Plus size={14} />
              {t("recurring.addFirst")}
            </button>
          </div>
        ) : (
          <div className="recurring-list">
            {active.map((r, i) => (
              <RecurringCard
                key={r.id}
                item={r}
                index={i}
                freqLabel={FREQ_LABELS[r.frequency]}
                typeLabel={TYPE_LABELS[r.type]}
                cancelConfirmId={cancelConfirmId}
                onEdit={() => navigate(`/recurring/${r.id}/edit`)}
                onCancelRequest={() => setCancelConfirmId(r.id)}
                onCancelAbort={() => setCancelConfirmId(null)}
                onCancelConfirm={() => handleCancel(r.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inactive section */}
      {inactive.length > 0 && (
        <div className="content-block" style={{ marginTop: 14 }}>
          <button
            onClick={() => setShowInactive((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <span className="recurring-section-title">
              {t("recurring.inactiveSectionTitle", { count: inactive.length })}
            </span>
            {showInactive ? (
              <ChevronUp size={14} color="var(--text-muted)" />
            ) : (
              <ChevronDown size={14} color="var(--text-muted)" />
            )}
          </button>

          {showInactive && (
            <div className="recurring-list" style={{ marginTop: 14 }}>
              {inactive.map((r, i) => (
                <RecurringCard
                  key={r.id}
                  item={r}
                  index={i}
                  freqLabel={FREQ_LABELS[r.frequency]}
                  typeLabel={TYPE_LABELS[r.type]}
                  cancelConfirmId={null}
                  inactive
                  onEdit={() => navigate(`/recurring/${r.id}/edit`)}
                  onCancelRequest={() => {}}
                  onCancelAbort={() => {}}
                  onCancelConfirm={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecurringCard({
  item,
  index,
  freqLabel,
  typeLabel,
  cancelConfirmId,
  inactive = false,
  onEdit,
  onCancelRequest,
  onCancelAbort,
  onCancelConfirm,
}: {
  item: RecurringExpense;
  index: number;
  freqLabel: string;
  typeLabel: string;
  cancelConfirmId: string | null;
  inactive?: boolean;
  onEdit: () => void;
  onCancelRequest: () => void;
  onCancelAbort: () => void;
  onCancelConfirm: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const paid = countPaidInstallments(item);
  const total = item.total_installments;
  const pct = total && total > 0 ? Math.round((paid / total) * 100) : null;
  const showConfirm = cancelConfirmId === item.id;

  const fromDate = item.start_date
    ? new Date(item.start_date + "T00:00:00").toLocaleDateString("es-UY", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div
      className={`recurring-card recurring-card--${item.type}${inactive ? " recurring-card--inactive" : ""}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 5,
            }}
          >
            {!inactive && <span className="active-pulse" />}
            <span
              style={{
                fontWeight: 600,
                fontSize: "0.97rem",
                color: "var(--text-primary)",
              }}
            >
              {item.name}
            </span>
            {item.vendor_name && (
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                · {item.vendor_name}
              </span>
            )}
            <span
              className={`recurring-type-badge recurring-type-badge--${item.type}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <TypeIcon type={item.type} size={9} />
              {typeLabel}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{ fontSize: "0.79rem", color: "var(--text-secondary)" }}
            >
              {item.category}
            </span>
            <span
              className="frequency-chip"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Repeat size={9} />
              {freqLabel}
            </span>
            {fromDate && (
              <span
                className="frequency-chip"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Calendar size={9} />
                {t("recurring.from", { date: fromDate })}
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.2px",
            }}
          >
            {item.currency}{" "}
            {item.amount.toLocaleString("es-UY", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          {item.type === "installment" && item.total_purchase_amount && (
            <div
              style={{
                fontSize: "0.74rem",
                color: "var(--text-muted)",
                marginTop: 1,
              }}
            >
              {t("recurring.paidOf")} {item.currency}{" "}
              {item.total_purchase_amount.toLocaleString("es-UY")}
            </div>
          )}
          <div
            style={{
              fontSize: "0.72rem",
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            {freqLabel.toLowerCase()}
          </div>
        </div>
      </div>

      {/* Installment progress */}
      {item.type === "installment" && total != null && (
        <div className="recurring-progress">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{ fontSize: "0.79rem", color: "var(--text-secondary)" }}
            >
              {t("recurring.installmentsPaidOf", { paid, total })}
            </span>
            <span
              style={{
                fontSize: "0.79rem",
                fontWeight: 600,
                color: pct === 100 ? "var(--color-success)" : "#f59e0b",
              }}
            >
              {pct ?? 0}%
            </span>
          </div>
          <div className="recurring-progress__bar">
            <div
              className="recurring-progress__fill"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          {item.total_purchase_amount && (
            <div
              style={{
                fontSize: "0.74rem",
                color: "var(--text-muted)",
                marginTop: 5,
              }}
            >
              {item.currency}{" "}
              {(item.amount * paid).toLocaleString("es-UY", {
                minimumFractionDigits: 2,
              })}{" "}
              {t("recurring.paidOf")} {item.currency}{" "}
              {item.total_purchase_amount.toLocaleString("es-UY", {
                minimumFractionDigits: 2,
              })}
            </div>
          )}
        </div>
      )}

      {/* Inline cancel confirm */}
      {showConfirm && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--color-danger-subtle)",
            border: "1px solid rgba(248,113,113,0.2)",
          }}
        >
          <p
            style={{
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--color-danger)",
              marginBottom: 4,
            }}
          >
            {t("recurring.confirmCancelTitle")}
          </p>
          <p
            style={{
              fontSize: "0.79rem",
              color: "var(--text-secondary)",
              marginBottom: 10,
            }}
          >
            {t("recurring.confirmCancelText")}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              className="button button--secondary button--small"
              onClick={onCancelAbort}
            >
              {t("recurring.cancelNo")}
            </button>
            <button
              className="button button--small"
              onClick={onCancelConfirm}
              style={{
                background: "rgba(248,113,113,0.15)",
                color: "#f87171",
                border: "1px solid rgba(248,113,113,0.3)",
              }}
            >
              {t("recurring.cancelYes")}
            </button>
          </div>
        </div>
      )}

      {/* Card actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 14,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <button
          className="button button--secondary button--small"
          onClick={onEdit}
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <Edit2 size={12} />
          {t("recurring.editBtn")}
        </button>
        {!inactive && !showConfirm && (
          <button
            className="button button--secondary button--small"
            onClick={onCancelRequest}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <XCircle size={12} />
            {t("recurring.cancelActionBtn")}
          </button>
        )}
        <button
          className="button button--small"
          onClick={() => navigate(`/recurring/${item.id}/edit`)}
          style={{
            background: "rgba(248,113,113,0.10)",
            color: "#f87171",
            border: "1px solid rgba(248,113,113,0.2)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Trash2 size={12} />
          {t("recurring.deleteBtn")}
        </button>
      </div>
    </div>
  );
}

export default RecurringExpenses;
