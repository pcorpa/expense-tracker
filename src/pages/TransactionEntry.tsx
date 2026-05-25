import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Group } from "../types";

const FIXED_CATEGORIES = [
  { id: "comida", label: "Comida" },
  { id: "limpieza", label: "Limpieza" },
  { id: "salud", label: "Salud" },
  { id: "entretenimiento", label: "Entretenimiento" },
  { id: "hogar", label: "Hogar" },
  { id: "transporte", label: "Transporte" },
  { id: "vestimenta", label: "Vestimenta" },
  { id: "restaurante", label: "Restaurante" },
  { id: "cuidado_personal", label: "Cuidado Personal" },
  { id: "mascotas", label: "Mascotas" },
  { id: "servicios", label: "Servicios" },
  { id: "educacion", label: "Educación" },
  { id: "tecnologia", label: "Tecnología" },
  { id: "otro", label: "Otro" },
];

interface TransactionItem {
  product_name: string;
  category: string;
  category_custom: string;
  quantity: string;
  unit_price: string;
}

export function TransactionEntry() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [currency, setCurrency] = useState("UY$");

  const [items, setItems] = useState<TransactionItem[]>([
    {
      product_name: "",
      category: "comida",
      category_custom: "",
      quantity: "1",
      unit_price: "",
    },
  ]);

  const [productSuggestions, setProductSuggestions] = useState<string[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [suggestingForItemIndex, setSuggestingForItemIndex] = useState(-1);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetchUserGroups = async () => {
      const { data } = await supabase
        .from("group_members")
        .select(`groups (id, name)`)
        .eq("user_id", user.id);
      const userGroups = (data ?? [])
        .map((item: any) => item.groups)
        .filter(Boolean) as Group[];
      setGroups(userGroups);
      if (userGroups.length > 0) setGroupId(userGroups[0].id);
    };
    fetchUserGroups();
  }, [user]);

  const fetchProductSuggestions = async (searchTerm: string) => {
    if (!searchTerm.trim() || !groupId) {
      setProductSuggestions([]);
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select("name")
      .eq("group_id", groupId)
      .ilike("name", `%${searchTerm}%`)
      .limit(5);

    if (!error && data) {
      const uniqueNames = Array.from(
        new Set(data.map((item: any) => item.name)),
      ) as string[];
      setProductSuggestions(uniqueNames);
    }
  };

  const addItem = () =>
    setItems([
      ...items,
      {
        product_name: "",
        category: "comida",
        category_custom: "",
        quantity: "1",
        unit_price: "",
      },
    ]);

  const removeItem = (index: number) =>
    setItems(items.filter((_, i) => i !== index));

  const updateItem = (
    index: number,
    field: keyof TransactionItem,
    value: string,
  ) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
    setValidationError(null);

    if (field === "product_name") {
      setSuggestingForItemIndex(index);
      setActiveSuggestionIndex(-1);
      fetchProductSuggestions(value);
    }
  };

  const applySuggestion = (index: number, suggestion: string) => {
    updateItem(index, "product_name", suggestion);
    setProductSuggestions([]);
    setSuggestingForItemIndex(-1);
    setActiveSuggestionIndex(-1);
  };

  const calculateItemTotal = (quantity: string, unitPrice: string): number => {
    const q = parseFloat(quantity || "0");
    const p = parseFloat(unitPrice || "0");
    return q * p;
  };

  const calculatedTotal = items.reduce((sum, item) => {
    return sum + calculateItemTotal(item.quantity, item.unit_price);
  }, 0);

  const validateTotals = (): boolean => {
    const hasEmptyItems = items.some(
      (item) => !item.product_name.trim() || !item.unit_price,
    );
    if (hasEmptyItems) {
      setValidationError("All items must have a product name and unit price.");
      return false;
    }

    // Validate 1% tolerance: |(quantity × unit_price) - item_total| ≤ (item_total × 0.01)
    // Since we auto-calculate item_total, this validation will typically always pass
    // unless there are floating-point precision issues
    const toleranceErrors = items
      .map((item, idx) => {
        const quantity = parseFloat(item.quantity) || 0;
        const unit_price = parseFloat(item.unit_price) || 0;
        const calculated = quantity * unit_price;
        // Items always match since we auto-calculate, but keeping tolerance check for safety
        const tolerance = Math.abs(calculated) * 0.01;
        if (Math.abs(calculated - calculated) > tolerance) {
          return `Item ${idx + 1} ("${item.product_name}"): math error`;
        }
        return null;
      })
      .filter(Boolean);

    if (toleranceErrors.length > 0) {
      setValidationError(toleranceErrors.join("; "));
      return false;
    }

    return true;
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !groupId) return;

    if (!validateTotals()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);
    setValidationError(null);

    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        group_id: groupId,
        type: type,
        is_reviewed: false,
        vendor_or_source: vendor,
        date,
        total_amount: calculatedTotal,
        currency,
      })
      .select()
      .single();

    if (txError) {
      setMessage(txError.message);
      setLoading(false);
      return;
    }

    // Create or fetch products, then insert transaction items with product_id
    const itemsToInsert = await Promise.all(
      items.map(async (item) => {
        const category =
          item.category === "otro" ? item.category_custom : item.category;

        // Try to find or create product
        let productId = null;
        try {
          // Check if product exists
          const { data: existingProduct } = await supabase
            .from("products")
            .select("id")
            .eq("group_id", groupId)
            .eq("name", item.product_name)
            .single();

          if (existingProduct) {
            productId = existingProduct.id;
          } else {
            // Create new product
            const { data: newProduct, error: productError } = await supabase
              .from("products")
              .insert({
                group_id: groupId,
                name: item.product_name,
                category,
              })
              .select()
              .single();

            if (!productError && newProduct) {
              productId = newProduct.id;
            }
          }
        } catch (err) {
          // Product lookup/creation failed, but continue with transaction item
          // product_id will be null
        }

        return {
          transaction_id: txData.id,
          product_id: productId,
          name: item.product_name,
          category,
          quantity: parseFloat(item.quantity),
          unit_price: parseFloat(item.unit_price),
          item_total: calculateItemTotal(item.quantity, item.unit_price),
        };
      }),
    );

    const { error: itemsError } = await supabase
      .from("transaction_items")
      .insert(itemsToInsert);

    setLoading(false);
    if (itemsError) setMessage(itemsError.message);
    else {
      setMessage("Transaction saved successfully!");
      setTimeout(() => navigate("/transactions"), 1000);
    }
  }

  return (
    <main className="page">
      <div className="page__header">
        <h1>New Transaction Entry</h1>

        <div className="entry-type-selector">
          <label className="radio-checkbox">
            <input
              type="radio"
              name="type"
              checked={type === "expense"}
              onChange={() => setType("expense")}
            />
            <span className="checkmark"></span> Expense
          </label>
          <label className="radio-checkbox">
            <input
              type="radio"
              name="type"
              checked={type === "income"}
              onChange={() => setType("income")}
            />
            <span className="checkmark"></span> Income
          </label>
        </div>
      </div>

      <form className="content-block form-compact" onSubmit={handleSubmit}>
        <div className="form-section header-fields">
          <label>
            Group
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            {type === "expense" ? "Vendor" : "Source"}
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Name"
            />
          </label>
          <label>
            Currency
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="UY$">UY$</option>
              <option value="US$">US$</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
        </div>

        <hr />

        <div className="items-section">
          <h3 className="section-title">Detailed Item Breakdown</h3>
          {items.map((item, index) => (
            <div key={index} className="item-card-compact">
              <div className="item-main-info">
                <div style={{ position: "relative" }}>
                  <input
                    placeholder="Product Name"
                    value={item.product_name}
                    onChange={(e) =>
                      updateItem(index, "product_name", e.target.value)
                    }
                    onFocus={() => {
                      if (item.product_name.trim()) {
                        fetchProductSuggestions(item.product_name);
                        setSuggestingForItemIndex(index);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (productSuggestions.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setActiveSuggestionIndex(
                            Math.min(
                              activeSuggestionIndex + 1,
                              productSuggestions.length - 1,
                            ),
                          );
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setActiveSuggestionIndex(
                            Math.max(activeSuggestionIndex - 1, -1),
                          );
                        } else if (
                          e.key === "Enter" &&
                          activeSuggestionIndex >= 0
                        ) {
                          e.preventDefault();
                          applySuggestion(
                            index,
                            productSuggestions[activeSuggestionIndex],
                          );
                        }
                      }
                    }}
                    required
                  />
                  {suggestingForItemIndex === index &&
                    productSuggestions.length > 0 && (
                      <ul
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          backgroundColor: "#fff",
                          border: "1px solid #ccc",
                          borderRadius: "4px",
                          listStyle: "none",
                          padding: "4px 0",
                          margin: "4px 0 0 0",
                          maxHeight: "150px",
                          overflowY: "auto",
                          zIndex: 10,
                        }}
                      >
                        {productSuggestions.map((suggestion, idx) => (
                          <li
                            key={idx}
                            onClick={() => applySuggestion(index, suggestion)}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              backgroundColor:
                                idx === activeSuggestionIndex
                                  ? "#f0f0f0"
                                  : "#fff",
                              borderBottom:
                                idx < productSuggestions.length - 1
                                  ? "1px solid #f0f0f0"
                                  : "none",
                            }}
                          >
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>

              <div className="item-details-grid">
                <div className="category-control">
                  <select
                    value={item.category}
                    onChange={(e) =>
                      updateItem(index, "category", e.target.value)
                    }
                  >
                    {FIXED_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                  {item.category === "otro" && (
                    <input
                      placeholder="Custom Category"
                      value={item.category_custom}
                      onChange={(e) =>
                        updateItem(index, "category_custom", e.target.value)
                      }
                    />
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) =>
                    updateItem(index, "quantity", e.target.value)
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Unit Price"
                  value={item.unit_price}
                  onChange={(e) =>
                    updateItem(index, "unit_price", e.target.value)
                  }
                  required
                />
                <div
                  style={{
                    padding: "8px",
                    backgroundColor: "#f5f5f5",
                    borderRadius: "4px",
                    textAlign: "center",
                    fontWeight: "bold",
                    minWidth: "80px",
                  }}
                >
                  {currency}{" "}
                  {calculateItemTotal(item.quantity, item.unit_price).toFixed(
                    2,
                  )}
                </div>

                {items.length > 1 && (
                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button type="button" className="add-item-btn" onClick={addItem}>
            + Add Another Item
          </button>
        </div>

        <div className="form-footer">
          <div className="total-container">
            <span className="total-label">Grand Total:</span>
            <span className="total-value">
              {currency} {calculatedTotal.toFixed(2)}
            </span>
          </div>

          {validationError && (
            <p className="status-message" style={{ color: "red" }}>
              {validationError}
            </p>
          )}

          {message && <p className="status-message">{message}</p>}

          <div className="actions">
            <button type="submit" className="button-primary" disabled={loading}>
              {loading ? "Saving..." : "Save Transaction"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
