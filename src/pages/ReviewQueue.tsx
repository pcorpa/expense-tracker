import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { getReviewTransactions, getFailedReceipts, retryReceipt, approveTransaction } from "../api/reviewQueue";
import { deleteReceipt } from "../api/receipts";
import type { ReviewTransaction } from "../api/reviewQueue";

const PAGE_SIZE = 20;

function receiptFileName(imageUrl: string): string {
  const base = imageUrl.split("/").pop() ?? imageUrl;
  return base.replace(/^\d+_/, "");
}

export function ReviewQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["review-transactions", user?.id, page],
    queryFn: () => getReviewTransactions(page, PAGE_SIZE),
    enabled: Boolean(user),
  });

  const failedQuery = useQuery({
    queryKey: ["failed-receipts", user?.id],
    queryFn: getFailedReceipts,
    enabled: Boolean(user),
  });

  const transactions: ReviewTransaction[] = query.data?.data ?? [];
  const totalCount: number = query.data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleRetry = async (receiptId: string) => {
    setRetrying(receiptId);
    try {
      await retryReceipt(receiptId);
      failedQuery.refetch();
      setPage(0);
      qc.invalidateQueries({ queryKey: ["review-transactions"] });
    } catch (err) {
      window.alert(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setRetrying(null);
  };

  const handleDelete = async (receiptId: string) => {
    setDeleting(receiptId);
    setConfirmDelete(null);
    try {
      await deleteReceipt(receiptId);
      failedQuery.refetch();
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setDeleting(null);
  };

  const handleApprove = async (transaction: ReviewTransaction) => {
    const items = transaction.transaction_items ?? [];

    const toleranceErrors = items
      .filter((item) => {
        const calculated = item.quantity * item.unit_price;
        const actual = item.item_total;
        const tolerance = Math.abs(actual) * 0.01;
        return Math.abs(calculated - actual) > tolerance;
      })
      .map(
        (item) =>
          `"${item.name}": calculated ${(item.quantity * item.unit_price).toFixed(2)} but total is ${item.item_total.toFixed(2)}`,
      );

    if (toleranceErrors.length > 0) {
      window.alert(
        t("review.mathErrors", { details: toleranceErrors.join("\n") }),
      );
      return;
    }

    setApproving(transaction.id);
    const subtotal = items.reduce((sum, item) => sum + item.item_total, 0);

    try {
      const result = await approveTransaction({
        transactionId: transaction.id,
        receiptId: transaction.receipt_id,
        subtotal,
      });

      if (!result.transactionUpdated) {
        window.alert(t("review.approvePermissionError"));
        return;
      }

      setPage(0);
      qc.invalidateQueries({ queryKey: ["review-transactions"] });
    } catch {
      window.alert(t("review.approveFailed"));
    } finally {
      setApproving(null);
    }
  };

  if (query.isLoading) {
    return (
      <main className="page">
        <p>{t("review.loading")}</p>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="page">
        <div className="alert">{String(query.error)}</div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("review.eyebrow")}</p>
          <h1>{t("review.title")}</h1>
          <p>{t("review.subtitle")}</p>
        </div>
      </div>

      <div className="content-block">
        {!transactions.length && !failedQuery.data?.length && (
          <p>{t("review.empty")}</p>
        )}

        {transactions.map((transaction) => {
          const receiptStatus = transaction.receipts?.[0]?.status;
          const items = transaction.transaction_items ?? [];

          if (receiptStatus === "pending" || receiptStatus === "processing") {
            return (
              <article key={transaction.id} className="ticket-card">
                <div className="ticket-card__header">
                  <div>
                    <strong>{t("review.aiAnalyzing")}</strong>
                    <span>{t("review.processing")}</span>
                  </div>
                </div>
                <div className="skeleton-loader">
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line short"></div>
                  <div className="skeleton-line"></div>
                </div>
              </article>
            );
          }

          const subtotal = items.reduce(
            (sum, item) => sum + (item.item_total ?? 0),
            0,
          );

          return (
            <article key={transaction.id} className="ticket-card">
              <div className="ticket-card__header">
                <div>
                  <strong>
                    {transaction.vendor_or_source ?? "Unknown source"}
                  </strong>
                  <span>{transaction.date ?? "No date"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{transaction.type.toUpperCase()}</span>
                    <strong>
                      ${transaction.total_amount?.toFixed(2) ?? "0.00"}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => navigate(`/review/${transaction.id}/edit`)}
                  >
                    {t("review.edit")}
                  </button>
                </div>
              </div>

              <div className="ticket-card__products">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="item-row-btn"
                    onClick={() =>
                      navigate(
                        `/review/${transaction.id}/items/${item.id}`,
                      )
                    }
                  >
                    <div className="item-row-btn__left">
                      <span className="item-row-btn__name">{item.name || "Unnamed item"}</span>
                      {item.category && (
                        <span className="item-row-btn__category">
                          {item.category}
                        </span>
                      )}
                    </div>
                    <div className="item-row-btn__right">
                      <span className="item-row-btn__math">
                        {item.quantity} × ${item.unit_price?.toFixed(2)}
                      </span>
                      <strong className="item-row-btn__total">
                        ${item.item_total?.toFixed(2)}
                      </strong>
                      <span className="item-row-btn__chevron">›</span>
                    </div>
                  </button>
                ))}

                <button
                  type="button"
                  className="add-item-btn"
                  onClick={() =>
                    navigate(`/review/${transaction.id}/items/new`)
                  }
                >
                  {t("review.addItem")}
                </button>
              </div>

              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border-color)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    {t("review.subtotal")}
                  </p>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: "1.2rem" }}>
                    ${subtotal.toFixed(2)}
                  </p>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => handleApprove(transaction)}
                  disabled={approving === transaction.id}
                >
                  {approving === transaction.id ? t("review.approving") : t("review.approve")}
                </button>
              </div>
            </article>
          );
        })}

        {totalPages > 1 && (
          <div className="tx-pagination">
            <button
              type="button"
              className="button button--secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("common.prevPage")}
            </button>
            <span className="tx-pagination__info">
              {t("common.pageInfo", { current: page + 1, total: totalPages })}
            </span>
            <button
              type="button"
              className="button button--secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("common.nextPage")}
            </button>
          </div>
        )}

        {!!failedQuery.data?.length && (
          <>
            <h2 style={{ marginTop: 32, fontSize: "1rem", color: "var(--text-muted)" }}>
              {t("review.failedSection")}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {failedQuery.data.map((receipt) => (
              <article key={receipt.id} className="ticket-card">
                <div className="ticket-card__header">
                  <div>
                    <strong>{receiptFileName(receipt.image_url)}</strong>
                    <span>{new Date(receipt.created_at).toLocaleDateString()}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => handleRetry(receipt.id)}
                      disabled={retrying === receipt.id || deleting === receipt.id || confirmDelete === receipt.id}
                    >
                      {retrying === receipt.id ? t("review.retrying") : t("review.retryAi")}
                    </button>
                    <button
                      type="button"
                      className="delete-btn"
                      onClick={() => setConfirmDelete(receipt.id)}
                      disabled={deleting === receipt.id || retrying === receipt.id}
                      aria-label="Delete failed receipt"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {confirmDelete === receipt.id && (
                  <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border-color)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}>
                    <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted)" }}>
                      {t("review.deleteConfirm")}
                    </p>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setConfirmDelete(null)}
                      >
                        {t("review.cancelDelete")}
                      </button>
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => handleDelete(receipt.id)}
                        disabled={deleting === receipt.id}
                      >
                        {deleting === receipt.id ? t("review.deleting") : t("review.deleteBtn")}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
