import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DayPicker } from "react-day-picker";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import "react-day-picker/style.css";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Group, Transaction } from "../types";

export function ExpenseList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "income">("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (!user) return;

    setLoading(true);

    supabase
      .from("group_members")
      .select("group_id, groups(id, name)")
      .eq("user_id", user.id)
      .then(({ data: memberships, error: membershipError }) => {
        if (membershipError || !memberships || memberships.length === 0) {
          setLoading(false);
          setTransactions([]);
          return;
        }

        const resolvedGroups = (memberships ?? [])
          .map((m: any) => m.groups)
          .filter(Boolean) as Group[];
        setGroups(resolvedGroups);

        const groupIds = memberships.map((m: any) => m.group_id);

        supabase
          .from("transactions")
          .select("*, transaction_items(*)")
          .in("group_id", groupIds)
          .order("date", { ascending: false })
          .then(({ data, error }) => {
            setLoading(false);
            if (error) {
              setError(error.message);
              return;
            }
            setTransactions(data ?? []);
          });
      });
  }, [user]);

  const filtered = useMemo(() => {
    let result = transactions;

    if (typeFilter !== "all") {
      result = result.filter((t) => t.type === typeFilter);
    }

    if (groupFilter !== "all") {
      result = result.filter((t) => t.group_id === groupFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((t) =>
        (t.vendor_or_source ?? "").toLowerCase().includes(q)
      );
    }

    if (dateRange?.from) {
      const from = dateRange.from.toISOString().split("T")[0];
      result = result.filter((t) => t.date && t.date >= from);
    }
    if (dateRange?.to) {
      const to = dateRange.to.toISOString().split("T")[0];
      result = result.filter((t) => t.date && t.date <= to);
    }

    if (sortBy === "amount") {
      result = [...result].sort(
        (a, b) => (b.total_amount ?? 0) - (a.total_amount ?? 0)
      );
    }

    return result;
  }, [transactions, typeFilter, groupFilter, search, dateRange, sortBy]);

  const dateLabel = dateRange?.from
    ? `${format(dateRange.from, "MMM d")}${dateRange.to ? ` – ${format(dateRange.to, "MMM d")}` : ""}`
    : t("transactions.dateRange");

  const hasDateFilter = !!dateRange?.from;

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("transactions.eyebrow")}</p>
          <h1>{t("transactions.title")}</h1>
          <p>{t("transactions.subtitle")}</p>
        </div>
      </div>

      <div className="content-block">
        {loading && <p>{t("transactions.loading")}</p>}
        {error && <div className="alert">{error}</div>}

        {!loading && (
          <div className="tx-filters">
            <input
              type="text"
              className="tx-search"
              placeholder={t("transactions.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="tx-filter-btns">
              {(["all", "expense", "income"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`tx-filter-btn${typeFilter === f ? " tx-filter-btn--active" : ""}`}
                  onClick={() => setTypeFilter(f)}
                >
                  {f === "all" ? t("transactions.allFilter") : f === "expense" ? t("transactions.expenseFilter") : t("transactions.incomeFilter")}
                </button>
              ))}
            </div>
            <select
              className="tx-sort-select"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="all">{t("transactions.allGroups")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`tx-date-btn${hasDateFilter ? " tx-date-btn--active" : ""}`}
              onClick={() => setShowDatePicker(true)}
            >
              {dateLabel}
            </button>
            <select
              className="tx-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "date" | "amount")}
            >
              <option value="date">{t("transactions.sortDate")}</option>
              <option value="amount">{t("transactions.sortAmount")}</option>
            </select>
          </div>
        )}

        {!loading && !filtered.length && (
          <p>{t("transactions.noMatch")}</p>
        )}

        <div className="ticket-list">
          {filtered.map((transaction) => (
            <article key={transaction.id} className="ticket-card">
              <div className="ticket-card__header">
                <div>
                  <strong>
                    {transaction.vendor_or_source ?? t("transactions.unknownSource")}
                  </strong>
                  <span>{transaction.date ?? t("transactions.noDate")}</span>
                </div>
                <div className="ticket-card__header-right">
                  <span className={`tx-badge tx-badge--${transaction.type}`}>
                    {transaction.type === "expense" ? t("transactions.expense") : t("transactions.income")}
                  </span>
                  <strong className={`tx-amount tx-amount--${transaction.type}`}>
                    ${transaction.total_amount?.toFixed(2) ?? "0.00"}
                  </strong>
                </div>
              </div>
              <p className="small-text">
                {transaction.is_reviewed ? t("transactions.reviewed") : t("transactions.pendingReview")}
              </p>
              {transaction.transaction_items?.length ? (
                <div className="ticket-card__products">
                  {transaction.transaction_items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="item-row-btn"
                      onClick={() =>
                        navigate(`/review/${transaction.id}/items/${item.id}`)
                      }
                    >
                      <div className="item-row-btn__left">
                        <span className="item-row-btn__name">
                          {item.name || t("transactions.unnamedItem")}
                        </span>
                        {item.category && (
                          <span className="item-row-btn__category">
                            {item.category}
                          </span>
                        )}
                      </div>
                      <div className="item-row-btn__right">
                        <span className="item-row-btn__math">
                          {item.quantity ?? 1} × $
                          {(item.unit_price ?? 0).toFixed(2)}
                        </span>
                        <strong className="item-row-btn__total">
                          ${(item.item_total ?? 0).toFixed(2)}
                        </strong>
                        <span className="item-row-btn__chevron">›</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>

      {showDatePicker && (
        <div
          className="date-picker-overlay"
          onClick={() => setShowDatePicker(false)}
        >
          <div
            className="date-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <DayPicker
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              disabled={{ after: new Date() }}
            />
            <div className="date-picker-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDateRange(undefined)}
              >
                {t("transactions.clear")}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setShowDatePicker(false)}
              >
                {t("transactions.done")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
