import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getTransactionHeader, updateTransactionHeader } from "../api/transactions";

type FormState = {
  vendor_or_source: string;
  date: string;
  type: "income" | "expense";
  total_amount: string;
};

export function ReviewTransactionEdit() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from: string = (location.state as any)?.from ?? "/review";
  const { t } = useTranslation();

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
    queryFn: () => getTransactionHeader(transactionId!),
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

    try {
      await updateTransactionHeader({
        id: transactionId!,
        vendor_or_source: form.vendor_or_source || null,
        date: form.date || null,
        type: form.type,
        total_amount: form.total_amount !== "" ? Number(form.total_amount) : null,
      });
      navigate(from);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const isLoading = !initialized && !transactionQuery.isError && transactionQuery.isLoading;

  return (
    <main className="page">
      <div className="page__header">
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => navigate(from)}
          style={{ marginBottom: 24 }}
        >
          ← {from === "/review" ? t("reviewEdit.back") : t("common.back")}
        </button>
        <p className="eyebrow">{t("reviewEdit.editTransaction")}</p>
        <h1>{form.vendor_or_source || t("reviewEdit.defaultTitle")}</h1>
      </div>

      {isLoading ? (
        <div className="content-block">
          <p>{t("reviewEdit.loading")}</p>
        </div>
      ) : transactionQuery.isError ? (
        <div className="content-block">
          <div className="alert">
            {t("reviewEdit.loadError")} {String(transactionQuery.error)}
          </div>
        </div>
      ) : (
        <div className="content-block">
          {error && <div className="alert">{error}</div>}

          <div className="form-grid">
            <div>
              <label htmlFor="tx-vendor">{t("reviewEdit.vendor")}</label>
              <input
                id="tx-vendor"
                value={form.vendor_or_source}
                onChange={(e) => field("vendor_or_source", e.target.value)}
                placeholder={t("reviewEdit.vendorPlaceholder")}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="tx-date">{t("reviewEdit.date")}</label>
              <input
                id="tx-date"
                type="date"
                value={form.date}
                onChange={(e) => field("date", e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="tx-type">{t("reviewEdit.type")}</label>
              <select
                id="tx-type"
                value={form.type}
                onChange={(e) => field("type", e.target.value as "income" | "expense")}
              >
                <option value="expense">{t("entry.expense")}</option>
                <option value="income">{t("entry.income")}</option>
              </select>
            </div>

            <div>
              <label htmlFor="tx-amount">{t("reviewEdit.totalAmount")}</label>
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
              onClick={() => navigate(from)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t("reviewEdit.saving") : t("common.save")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
