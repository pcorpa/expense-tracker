import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getTransactionHeader, getTransactionItem, upsertTransactionItem } from "../api/transactions";

const CATEGORIES = [
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

type FormState = {
  name: string;
  category: string;
  quantity: string;
  unit_price: string;
  item_total: string;
};

export function ReviewItemEdit() {
  const { transactionId, itemId } = useParams<{
    transactionId: string;
    itemId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from: string = (location.state as any)?.from ?? "/review";
  const { t } = useTranslation();
  const isNew = itemId === "new";

  const [form, setForm] = useState<FormState>({
    name: "",
    category: "Otro",
    quantity: "1",
    unit_price: "0.00",
    item_total: "0.00",
  });
  const [initialized, setInitialized] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transactionQuery = useQuery({
    queryKey: ["transaction-header", transactionId],
    queryFn: () => getTransactionHeader(transactionId!),
    enabled: Boolean(transactionId),
  });

  const itemQuery = useQuery({
    queryKey: ["transaction-item", itemId],
    queryFn: () => getTransactionItem(itemId!),
    enabled: Boolean(itemId) && !isNew,
  });

  useEffect(() => {
    if (itemQuery.data && !initialized) {
      const d = itemQuery.data;
      setForm({
        name: d.name ?? "",
        category: d.category ?? "Otro",
        quantity: String(d.quantity ?? 1),
        unit_price: String(d.unit_price ?? 0),
        item_total: String(d.item_total ?? 0),
      });
      setInitialized(true);
    }
  }, [itemQuery.data, initialized]);

  const qty = Number(form.quantity) || 0;
  const price = Number(form.unit_price) || 0;
  const total = Number(form.item_total) || 0;
  const calculatedTotal = qty * price;
  const hasMismatch =
    Math.abs(calculatedTotal - total) > Math.abs(total) * 0.01 &&
    total !== 0;

  function field(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      await upsertTransactionItem({
        id: isNew ? crypto.randomUUID() : itemId!,
        transaction_id: transactionId!,
        name: form.name,
        category: form.category || "Otro",
        quantity: Number(form.quantity) || 0,
        unit_price: Number(form.unit_price) || 0,
        item_total: Number(form.item_total) || 0,
      });
      navigate(from);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const isLoading = !initialized && !itemQuery.isError && itemQuery.isLoading;

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
        <p className="eyebrow">{isNew ? t("reviewEdit.newItem") : t("reviewEdit.editItem")}</p>
        <h1>
          {transactionQuery.data?.vendor_or_source ?? t("reviewEdit.defaultTransaction")}
        </h1>
        {transactionQuery.data?.date && (
          <p>{transactionQuery.data.date}</p>
        )}
      </div>

      {isLoading ? (
        <div className="content-block">
          <p>{t("reviewEdit.loadingItem")}</p>
        </div>
      ) : itemQuery.isError ? (
        <div className="content-block">
          <div className="alert">
            {t("reviewEdit.loadItemError")} {String(itemQuery.error)}
          </div>
        </div>
      ) : (
        <div className="content-block">
          {error && <div className="alert">{error}</div>}

          <div className="form-grid">
            <div>
              <label htmlFor="item-name">{t("reviewEdit.productName")}</label>
              <input
                id="item-name"
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
                placeholder={t("reviewEdit.productNamePlaceholder")}
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="item-category">{t("reviewEdit.category")}</label>
              <select
                id="item-category"
                value={form.category}
                onChange={(e) => field("category", e.target.value)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {t(cat.i18nKey)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="item-qty">{t("reviewEdit.quantity")}</label>
              <input
                id="item-qty"
                type="number"
                value={form.quantity}
                onChange={(e) => field("quantity", e.target.value)}
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <label htmlFor="item-price">{t("reviewEdit.unitPrice")}</label>
              <input
                id="item-price"
                type="number"
                value={form.unit_price}
                onChange={(e) => field("unit_price", e.target.value)}
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <label htmlFor="item-total">
                {t("reviewEdit.itemTotal")}
                {hasMismatch && (
                  <span
                    style={{
                      color: "var(--color-accent)",
                      marginLeft: 8,
                      fontWeight: 400,
                      textTransform: "none",
                      fontSize: "0.8rem",
                    }}
                  >
                    {t("reviewEdit.calculated")} {calculatedTotal.toFixed(2)}
                  </span>
                )}
              </label>
              <input
                id="item-total"
                type="number"
                value={form.item_total}
                onChange={(e) => field("item_total", e.target.value)}
                step="0.01"
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
              disabled={saving || !form.name.trim()}
            >
              {saving ? t("reviewEdit.saving") : t("reviewEdit.saveItem")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
