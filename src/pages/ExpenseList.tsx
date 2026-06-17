import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DayPicker } from "react-day-picker";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, ImageIcon, Loader2, Pencil, Trash2, X } from "lucide-react";
import "react-day-picker/style.css";
import { useAuth } from "../lib/auth";
import { ConfirmModal } from "../components/ConfirmModal";
import { getTransactions, deleteTransaction, getReceiptSignedUrl } from "../api/transactions";
import { getGroups } from "../api/groups";
import type { Transaction } from "../types";

const PAGE_SIZE = 50;

export function ExpenseList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "income">("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [page, setPage] = useState(0);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ["my-groups"],
    queryFn: getGroups,
    enabled: Boolean(user),
  });
  const groups = groupsQuery.data ?? [];
  const groupIds = groups.map((g) => g.id);

  // Debounce search to avoid a query on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to page 0 whenever any filter changes
  useEffect(() => {
    setPage(0);
  }, [typeFilter, groupFilter, debouncedSearch, dateRange, sortBy]);

  const txQuery = useQuery({
    queryKey: [
      "transactions",
      { groupIds, typeFilter, groupFilter, debouncedSearch, dateFrom: dateRange?.from, dateTo: dateRange?.to, sortBy, page },
    ],
    queryFn: () =>
      getTransactions({
        groupIds: groupFilter === "all" ? groupIds : [groupFilter],
        type: typeFilter === "all" ? undefined : typeFilter,
        vendorSearch: debouncedSearch.trim() || undefined,
        dateFrom: dateRange?.from?.toISOString().split("T")[0],
        dateTo: dateRange?.to?.toISOString().split("T")[0],
        sortBy,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: groupIds.length > 0,
  });

  const transactions: Transaction[] = txQuery.data?.data ?? [];
  const totalCount: number = txQuery.data?.count ?? 0;
  const loading = groupsQuery.isFetching || txQuery.isFetching;
  const error = txQuery.error ? (txQuery.error as Error).message : null;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setDeleteTarget(null);
    },
  });

  const openReceipt = useCallback(async (imagePath: string) => {
    setLightboxLoading(true);
    try {
      const url = await getReceiptSignedUrl(imagePath);
      setLightboxUrl(url);
    } catch {
      // silently ignore — lightbox simply won't open
    } finally {
      setLightboxLoading(false);
    }
  }, []);

  const dateLabel = dateRange?.from
    ? `${format(dateRange.from, "MMM d")}${dateRange.to ? ` – ${format(dateRange.to, "MMM d")}` : ""}`
    : t("transactions.dateRange");

  const hasDateFilter = !!dateRange?.from;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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

        {!loading && !transactions.length && (
          <p>{t("transactions.noMatch")}</p>
        )}

        <div className="ticket-list">
          {transactions.map((transaction) => {
            const isExpanded = expandedIds.has(transaction.id);
            const receiptPath = (transaction.receipts as any)?.image_url ?? null;
            return (
              <article
                key={transaction.id}
                className="ticket-card ticket-card--collapsible"
                onClick={() => toggleExpanded(transaction.id)}
              >
                <div className="ticket-card__header">
                  <div className="ticket-card__title-area">
                    <span className="ticket-card__chevron">
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    <div className="ticket-card__info">
                      <strong>
                        {transaction.vendor_or_source ?? t("transactions.unknownSource")}
                      </strong>
                      <span>{transaction.date ?? t("transactions.noDate")}</span>
                    </div>
                  </div>
                  <div className="ticket-card__header-right">
                    <span className={`tx-badge tx-badge--${transaction.type}`}>
                      {transaction.type === "expense" ? t("transactions.expense") : t("transactions.income")}
                    </span>
                    <strong className={`tx-amount tx-amount--${transaction.type}`}>
                      ${transaction.total_amount?.toFixed(2) ?? "0.00"}
                    </strong>
                    {receiptPath && (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={(e) => { e.stopPropagation(); openReceipt(receiptPath); }}
                        title={t("transactions.viewReceipt")}
                      >
                        <ImageIcon size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/review/${transaction.id}/edit`, {
                          state: { from: "/transactions" },
                        });
                      }}
                      title={t("common.edit")}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      style={{ color: "var(--color-danger, #e53e3e)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget({
                          id: transaction.id,
                          name: transaction.vendor_or_source ?? t("transactions.unknownSource"),
                        });
                      }}
                      title={t("common.delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <>
                    <p className="small-text" style={{ marginTop: 10 }}>
                      {transaction.is_reviewed ? t("transactions.reviewed") : t("transactions.pendingReview")}
                    </p>
                    {transaction.transaction_items?.length ? (
                      <div className="ticket-card__products">
                        {transaction.transaction_items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="item-row-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/review/${transaction.id}/items/${item.id}`, {
                                state: { from: "/transactions" },
                              });
                            }}
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
                  </>
                )}
              </article>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="tx-pagination">
            <button
              type="button"
              className="button button--secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("transactions.prevPage")}
            </button>
            <span className="tx-pagination__info">
              {t("transactions.pageInfo", { current: page + 1, total: totalPages })}
            </span>
            <button
              type="button"
              className="button button--secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("transactions.nextPage")}
            </button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("transactions.deleteTitle")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      >
        {t("transactions.deleteBody", { name: deleteTarget?.name ?? "" })}
      </ConfirmModal>

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

      {lightboxLoading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <Loader2 size={32} color="#fff" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
          >
            <X size={18} />
          </button>
          <img
            src={lightboxUrl}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 8, objectFit: "contain", boxShadow: "0 16px 48px rgba(0,0,0,0.6)" }}
            alt="Receipt"
          />
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
