import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Transaction } from "../types";

type ReviewItem = {
  id: string;
  transaction_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
  created_at: string;
};

type ReviewTransaction = Omit<Transaction, "transaction_items"> & {
  transaction_items: ReviewItem[];
  receipts?: { status: string }[];
};

type FailedReceipt = {
  id: string;
  created_at: string;
  status: string;
  image_url: string;
};

function receiptFileName(imageUrl: string): string {
  const base = imageUrl.split("/").pop() ?? imageUrl;
  // storage path is `userId/timestamp_originalname` — strip the timestamp prefix
  return base.replace(/^\d+_/, "");
}

async function fetchReviewTransactions() {
  const { data, error } = await supabase
    .from("transactions")
    .select("*, transaction_items(*), receipts(status)")
    .eq("is_reviewed", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as ReviewTransaction[];
}

async function fetchFailedReceipts() {
  const { data, error } = await supabase
    .from("receipts")
    .select("id, created_at, status, image_url")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as FailedReceipt[]).filter(
    (r) => r.status === "error" || r.status === "pending",
  );
}

export function ReviewQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["review-transactions", user?.id],
    queryFn: fetchReviewTransactions,
    enabled: Boolean(user),
  });

  const failedQuery = useQuery({
    queryKey: ["failed-receipts", user?.id],
    queryFn: fetchFailedReceipts,
    enabled: Boolean(user),
  });

  const transactions = useMemo(() => {
    if (!query.data) return [];
    return query.data;
  }, [query.data]);

  const handleRetry = async (receiptId: string) => {
    setRetrying(receiptId);
    const { error } = await supabase.functions.invoke("process-receipts", {
      body: { receipt_id: receiptId },
    });
    setRetrying(null);
    if (error) {
      window.alert(`Retry failed: ${error.message}`);
      return;
    }
    failedQuery.refetch();
    query.refetch();
  };

  const handleDelete = async (receiptId: string) => {
    setDeleting(receiptId);
    setConfirmDelete(null);
    const { error } = await supabase.from("receipts").delete().eq("id", receiptId);
    setDeleting(null);
    if (error) {
      window.alert(`Delete failed: ${error.message}`);
      return;
    }
    failedQuery.refetch();
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
        `Math errors detected (outside 1% tolerance):\n${toleranceErrors.join("\n")}\n\nEdit the items to fix the discrepancies before approving.`,
      );
      return;
    }

    setApproving(transaction.id);
    const subtotal = items.reduce((sum, item) => sum + item.item_total, 0);

    const [transactionResult, receiptResult] = await Promise.all([
      supabase
        .from("transactions")
        .update({ total_amount: subtotal, is_reviewed: true })
        .eq("id", transaction.id)
        .select("id"),
      transaction.receipt_id
        ? supabase
            .from("receipts")
            .update({ status: "completed" })
            .eq("id", transaction.receipt_id)
        : Promise.resolve({ data: null, error: null }),
    ]);

    setApproving(null);

    if (transactionResult.error || receiptResult.error) {
      window.alert("Failed to approve transaction. Please try again.");
      return;
    }

    if (!transactionResult.data || transactionResult.data.length === 0) {
      window.alert("Could not approve — the transaction was not updated. Check that you have permission.");
      return;
    }

    query.refetch();
  };

  if (query.isLoading) {
    return (
      <main className="page">
        <p>Loading review queue…</p>
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
          <p className="eyebrow">Human review</p>
          <h1>AI-reviewed transactions</h1>
          <p>
            Tap an item to edit it, then approve the transaction once everything
            looks right.
          </p>
        </div>
      </div>

      <div className="content-block">
        {!transactions.length && !failedQuery.data?.length && (
          <p>No transactions need review right now.</p>
        )}

        {transactions.map((transaction) => {
          const receiptStatus = transaction.receipts?.[0]?.status;
          const items = transaction.transaction_items ?? [];

          if (receiptStatus === "pending" || receiptStatus === "processing") {
            return (
              <article key={transaction.id} className="ticket-card">
                <div className="ticket-card__header">
                  <div>
                    <strong>AI is analyzing receipt…</strong>
                    <span>Processing</span>
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
                    Edit
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
                  + Add item
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
                    Subtotal
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
                  {approving === transaction.id ? "Approving…" : "Approve"}
                </button>
              </div>
            </article>
          );
        })}
        {!!failedQuery.data?.length && (
          <>
            <h2 style={{ marginTop: 32, fontSize: "1rem", color: "var(--text-muted)" }}>
              Failed — AI could not process
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
                      {retrying === receipt.id ? "Retrying…" : "Retry AI"}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
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
                      Delete this failed receipt? This cannot be undone.
                    </p>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => handleDelete(receipt.id)}
                        disabled={deleting === receipt.id}
                      >
                        {deleting === receipt.id ? "Deleting…" : "Delete"}
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
