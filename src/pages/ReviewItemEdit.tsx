import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

const CATEGORIES = [
  "Comida", "Limpieza", "Salud", "Entretenimiento", "Hogar",
  "Transporte", "Vestimenta", "Restaurante", "Cuidado Personal",
  "Mascotas", "Servicios", "Educación", "Tecnología", "Otro",
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("vendor_or_source, date")
        .eq("id", transactionId!)
        .single();
      if (error) throw error;
      return data as { vendor_or_source: string | null; date: string | null };
    },
    enabled: Boolean(transactionId),
  });

  const itemQuery = useQuery({
    queryKey: ["transaction-item", itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_items")
        .select("*")
        .eq("id", itemId!)
        .single();
      if (error) throw error;
      return data as {
        name: string;
        category: string | null;
        quantity: number;
        unit_price: number;
        item_total: number;
      };
    },
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

    const payload = {
      id: isNew ? crypto.randomUUID() : itemId!,
      transaction_id: transactionId!,
      name: form.name,
      category: form.category || "Otro",
      quantity: Number(form.quantity) || 0,
      unit_price: Number(form.unit_price) || 0,
      item_total: Number(form.item_total) || 0,
    };

    const { error: saveError } = await supabase
      .from("transaction_items")
      .upsert(payload, { onConflict: "id" });

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    navigate("/review");
  };

  const isLoading = !initialized && itemQuery.isLoading;

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
        <p className="eyebrow">{isNew ? "New item" : "Edit item"}</p>
        <h1>
          {transactionQuery.data?.vendor_or_source ?? "Transaction"}
        </h1>
        {transactionQuery.data?.date && (
          <p>{transactionQuery.data.date}</p>
        )}
      </div>

      {isLoading ? (
        <div className="content-block">
          <p>Loading item…</p>
        </div>
      ) : (
        <div className="content-block">
          {error && <div className="alert">{error}</div>}

          <div className="form-grid">
            <div>
              <label htmlFor="item-name">Product name</label>
              <input
                id="item-name"
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
                placeholder="e.g. Leche entera"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="item-category">Category</label>
              <select
                id="item-category"
                value={form.category}
                onChange={(e) => field("category", e.target.value)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="item-qty">Quantity</label>
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
              <label htmlFor="item-price">Unit price</label>
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
                Item total
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
                    calculated: {calculatedTotal.toFixed(2)}
                  </span>
                )}
              </label>
              <input
                id="item-total"
                type="number"
                value={form.item_total}
                onChange={(e) => field("item_total", e.target.value)}
                step="0.01"
                min="0"
              />
            </div>
          </div>

          <div
            className="actions"
            style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid rgba(0,217,255,0.1)" }}
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
              disabled={saving || !form.name.trim()}
            >
              {saving ? "Saving…" : "Save item"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
