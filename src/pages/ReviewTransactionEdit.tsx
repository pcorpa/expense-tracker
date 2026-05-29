import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

type FormState = {
  vendor_or_source: string;
  date: string;
  type: "income" | "expense";
  total_amount: string;
};

export function ReviewTransactionEdit() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>({
    vendor_or_source: "",
    date: "",
    type: "expense",
    total_amount: "",
  });
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transactionQuery = useQuery({
    queryKey: ["transaction-header", transactionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("vendor_or_source, date, type, total_amount")
        .eq("id", transactionId!)
        .single();
      if (error) throw error;
      return data as {
        vendor_or_source: string | null;
        date: string | null;
        type: "income" | "expense";
        total_amount: number | null;
      };
    },
    enabled: Boolean(transactionId),
  });

  useEffect(() => {
    if (transactionQuery.data && !initialized) {
      const d = transactionQuery.data;
      setForm({
        vendor_or_source: d.vendor_or_source ?? "",
        date: d.date ?? "",
        type: d.type ?? "expense",
        total_amount: d.total_amount != null ? String(d.total_amount) : "",
      });
      setInitialized(true);
    }
  }, [transactionQuery.data, initialized]);

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const { error: saveError } = await supabase
      .from("transactions")
      .update({
        vendor_or_source: form.vendor_or_source || null,
        date: form.date || null,
        type: form.type,
        total_amount: form.total_amount !== "" ? Number(form.total_amount) : null,
      })
      .eq("id", transactionId!);

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    navigate("/review");
  };

  const isLoading = !initialized && !transactionQuery.isError && transactionQuery.isLoading;

  return (
    <main className="page">
      <div className="page__header">
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => navigate("/review")}
          style={{ marginBottom: 24 }}
        >
          ← Back to Review Queue
        </button>
        <p className="eyebrow">Edit transaction</p>
        <h1>{form.vendor_or_source || "Transaction details"}</h1>
      </div>

      {isLoading ? (
        <div className="content-block">
          <p>Loading transaction…</p>
        </div>
      ) : transactionQuery.isError ? (
        <div className="content-block">
          <div className="alert">
            Failed to load transaction: {String(transactionQuery.error)}
          </div>
        </div>
      ) : (
        <div className="content-block">
          {error && <div className="alert">{error}</div>}

          <div className="form-grid">
            <div>
              <label htmlFor="tx-vendor">Vendor / source</label>
              <input
                id="tx-vendor"
                value={form.vendor_or_source}
                onChange={(e) => field("vendor_or_source", e.target.value)}
                placeholder="e.g. Supermercado DIA"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="tx-date">Date</label>
              <input
                id="tx-date"
                type="date"
                value={form.date}
                onChange={(e) => field("date", e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="tx-type">Type</label>
              <select
                id="tx-type"
                value={form.type}
                onChange={(e) => field("type", e.target.value as "income" | "expense")}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>

            <div>
              <label htmlFor="tx-amount">Total amount</label>
              <input
                id="tx-amount"
                type="number"
                value={form.total_amount}
                onChange={(e) => field("total_amount", e.target.value)}
                step="0.01"
                min="0"
                placeholder="0.00"
              />
            </div>
          </div>

          <div
            className="actions"
            style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border-color)" }}
          >
            <button
              type="button"
              className="button button--secondary"
              onClick={() => navigate("/review")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
