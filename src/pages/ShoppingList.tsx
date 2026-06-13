import { useState, useMemo, useEffect } from "react";
import { Search, ShoppingCart, Check, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Transaction } from "../types";

const SHOPPING_CATEGORIES = ["Comida", "Limpieza", "Cuidado Personal"] as const;
type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

const CATEGORY_COLORS: Record<ShoppingCategory, string> = {
  Comida: "#3b82f6",
  Limpieza: "#34d399",
  "Cuidado Personal": "#e879f9",
};

type ShoppingItem = {
  key: string;
  displayName: string;
  category: ShoppingCategory;
  monthsPresent: number;
  frequency: number;
  avgQuantity: number;
  latestPrice: number | null;
  avgPrice: number | null;
  alreadyThisMonth: boolean;
  thisMonthQty: number;
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ShoppingItemRow({
  item,
  historyMonths,
}: {
  item: ShoppingItem;
  historyMonths: number;
}) {
  const catColor = CATEGORY_COLORS[item.category] ?? "#8b949e";

  const dots =
    historyMonths <= 6
      ? Array.from({ length: historyMonths }, (_, i) => i < item.monthsPresent)
      : null;

  let trendSymbol = "–";
  let trendClass = "sl-trend-flat";
  if (item.latestPrice !== null && item.avgPrice !== null && item.avgPrice > 0) {
    if (item.latestPrice > item.avgPrice * 1.03) {
      trendSymbol = "↑";
      trendClass = "sl-trend-up";
    } else if (item.latestPrice < item.avgPrice * 0.97) {
      trendSymbol = "↓";
      trendClass = "sl-trend-down";
    }
  }

  const qty = item.avgQuantity;
  const qtyDisplay = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(1);

  return (
    <div
      className={`sl-item${item.alreadyThisMonth ? " sl-item--bought" : ""}`}
      style={{ "--cat-color": catColor } as React.CSSProperties}
    >
      <div className="sl-checkbox">
        {item.alreadyThisMonth && <Check size={11} strokeWidth={3} />}
      </div>
      <span className="sl-item__name">{item.displayName}</span>
      <div className="sl-item__row2">
        <span
          className="sl-badge"
          style={{ background: hexToRgba(catColor, 0.14), color: catColor }}
        >
          {item.category}
        </span>
        <span className="sl-item__meta">~{qtyDisplay}</span>
        {item.latestPrice !== null && (
          <span className="sl-item__price">
            ${Math.round(item.latestPrice)}{" "}
            <span className={trendClass}>{trendSymbol}</span>
          </span>
        )}
        {dots !== null ? (
          <div className="sl-dots">
            {dots.map((filled, i) => (
              <span
                key={i}
                className={`sl-dot${filled ? "" : " sl-dot--empty"}`}
              />
            ))}
          </div>
        ) : (
          <span className="sl-item__meta">{item.monthsPresent}/12</span>
        )}
      </div>
    </div>
  );
}

export function ShoppingList() {
  const { user } = useAuth();

  const [historyMonths, setHistoryMonths] = useState<3 | 6 | 12>(6);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set<string>(SHOPPING_CATEGORIES)
  );
  const [threshold, setThreshold] = useState(2);
  const [search, setSearch] = useState("");
  const [showBought, setShowBought] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - historyMonths);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .then(({ data: memberships }) => {
        if (!memberships || memberships.length === 0) {
          setLoading(false);
          setTransactions([]);
          return;
        }
        const groupIds = memberships.map((m: any) => m.group_id);

        supabase
          .from("transactions")
          .select("*, transaction_items(*)")
          .in("group_id", groupIds)
          .eq("is_reviewed", true)
          .eq("type", "expense")
          .gte("date", cutoffStr)
          .then(({ data }) => {
            setLoading(false);
            setTransactions(data ?? []);
          });
      });
  }, [user, historyMonths]);

  const currentMonth = new Date().toISOString().slice(0, 7);

  const shoppingItems = useMemo<ShoppingItem[]>(() => {
    type RawEntry = {
      key: string;
      rawName: string;
      category: ShoppingCategory;
      quantity: number;
      unitPrice: number;
      month: string;
      date: string;
    };

    const enriched: RawEntry[] = [];

    for (const tx of transactions) {
      if (!tx.date) continue;
      const month = tx.date.slice(0, 7);
      for (const item of tx.transaction_items ?? []) {
        if (
          !item.category ||
          !(SHOPPING_CATEGORIES as readonly string[]).includes(item.category)
        )
          continue;
        enriched.push({
          key: item.product_id ?? item.name.trim().toLowerCase(),
          rawName: item.name.trim(),
          category: item.category as ShoppingCategory,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          month,
          date: tx.date,
        });
      }
    }

    const map = new Map<string, RawEntry[]>();
    for (const e of enriched) {
      const arr = map.get(e.key) ?? [];
      arr.push(e);
      map.set(e.key, arr);
    }

    const items: ShoppingItem[] = [];

    for (const [key, entries] of map) {
      const months = new Set(entries.map((e) => e.month));
      const monthsPresent = months.size;

      const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
      const displayName = sorted[0].rawName;

      const catCount = new Map<string, number>();
      for (const e of entries)
        catCount.set(e.category, (catCount.get(e.category) ?? 0) + 1);
      const category = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0] as ShoppingCategory;

      const avgQuantity =
        entries.reduce((s, e) => s + e.quantity, 0) / entries.length;

      const priced = entries.filter((e) => e.unitPrice > 0);
      const latestPrice = sorted.find((e) => e.unitPrice > 0)?.unitPrice ?? null;
      const avgPrice =
        priced.length > 0
          ? priced.reduce((s, e) => s + e.unitPrice, 0) / priced.length
          : null;

      const thisMonthEntries = entries.filter((e) => e.month === currentMonth);
      const alreadyThisMonth = thisMonthEntries.length > 0;
      const thisMonthQty = thisMonthEntries.reduce((s, e) => s + e.quantity, 0);

      items.push({
        key,
        displayName,
        category,
        monthsPresent,
        frequency: monthsPresent / historyMonths,
        avgQuantity,
        latestPrice,
        avgPrice,
        alreadyThisMonth,
        thisMonthQty,
      });
    }

    return items.sort((a, b) => b.frequency - a.frequency);
  }, [transactions, historyMonths, currentMonth]);

  const filtered = useMemo(
    () =>
      shoppingItems
        .filter((i) => activeCategories.has(i.category))
        .filter((i) => i.monthsPresent >= threshold)
        .filter(
          (i) =>
            !search ||
            i.displayName.toLowerCase().includes(search.toLowerCase())
        ),
    [shoppingItems, activeCategories, threshold, search]
  );

  const toBuy = filtered.filter((i) => !i.alreadyThisMonth);
  const bought = filtered.filter((i) => i.alreadyThisMonth);
  const progressPct =
    filtered.length > 0 ? Math.round((bought.length / filtered.length) * 100) : 0;

  function toggleCategory(cat: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size === 1) return prev;
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  return (
    <>
      <style>{`
        .shopping-list{max-width:800px;margin:0 auto;padding:32px 24px}
        .sl-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:16px;flex-wrap:wrap}
        .sl-title{font-size:1.5rem;font-weight:700;color:var(--text-primary);margin:0 0 3px}
        .sl-subtitle{font-size:0.8rem;color:var(--text-muted);margin:0}
        .sl-history-select{padding:7px 12px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:0.82rem;cursor:pointer;align-self:flex-start;outline:none;font-family:inherit}
        .sl-progress{background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:14px}
        .sl-progress__text{font-size:0.85rem;color:var(--text-secondary);flex-shrink:0;white-space:nowrap}
        .sl-progress__text strong{color:var(--text-primary)}
        .sl-progress__bar{flex:1;height:5px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;min-width:60px}
        .sl-progress__fill{height:100%;background:var(--color-success);border-radius:3px;transition:width 0.4s ease}
        .sl-progress__pct{font-size:0.85rem;font-weight:600;color:var(--color-success);min-width:36px;text-align:right}
        .sl-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
        .sl-chip{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-muted);font-size:0.78rem;font-weight:500;cursor:pointer;transition:all 0.15s;font-family:inherit}
        .sl-chip[data-active="true"]{border-color:var(--cat-color);background:var(--cat-bg);color:var(--cat-color)}
        .sl-chip__dot{width:7px;height:7px;border-radius:50%;background:var(--cat-color);flex-shrink:0}
        .sl-controls{display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap}
        .sl-search-wrap{position:relative;flex:1;min-width:150px}
        .sl-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none;display:flex}
        .sl-search{width:100%;padding:8px 12px 8px 34px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);font-size:0.85rem;outline:none;font-family:inherit;box-sizing:border-box}
        .sl-search:focus{border-color:var(--color-accent)}
        .sl-select{padding:8px 12px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:0.8rem;cursor:pointer;outline:none;font-family:inherit}
        .sl-section{margin-bottom:24px}
        .sl-section-label{display:flex;align-items:center;gap:8px;padding-bottom:10px;font-size:0.68rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-color);margin-bottom:8px}
        .sl-section-count{background:rgba(255,255,255,0.06);border-radius:10px;padding:2px 8px;font-size:0.65rem}
        .sl-list{display:flex;flex-direction:column;gap:4px}
        .sl-item{display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:10px 12px;padding:11px 14px;background:var(--bg-card);border:1px solid var(--border-color);border-left:3px solid transparent;border-radius:8px;transition:background 0.12s,border-color 0.12s}
        .sl-item:hover{background:var(--bg-secondary);border-left-color:var(--cat-color)}
        .sl-checkbox{width:22px;height:22px;border-radius:50%;border:2px solid var(--cat-color);display:grid;place-items:center;flex-shrink:0;color:transparent}
        .sl-item__name{font-size:0.88rem;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .sl-item__row2{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;justify-content:flex-end}
        .sl-badge{padding:3px 9px;border-radius:12px;font-size:0.68rem;font-weight:600;white-space:nowrap;flex-shrink:0}
        .sl-item__meta{font-size:0.75rem;color:var(--text-muted);white-space:nowrap;flex-shrink:0}
        .sl-item__price{font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;flex-shrink:0}
        .sl-trend-up{color:var(--color-danger);font-size:0.72rem}
        .sl-trend-down{color:var(--color-success);font-size:0.72rem}
        .sl-trend-flat{color:var(--text-muted);font-size:0.72rem}
        .sl-dots{display:flex;gap:3px;align-items:center;flex-shrink:0}
        .sl-dot{width:7px;height:7px;border-radius:50%;background:var(--cat-color)}
        .sl-dot--empty{background:rgba(255,255,255,0.11)}
        .sl-item--bought{opacity:0.48;border-left-color:var(--color-success)!important;background:rgba(52,211,153,0.025)}
        .sl-item--bought .sl-item__name{text-decoration:line-through;text-decoration-color:rgba(255,255,255,0.2)}
        .sl-item--bought .sl-checkbox{background:var(--color-success);border-color:var(--color-success);color:#0d1117}
        .sl-toggle-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;background:transparent;border:1px dashed var(--border-strong);border-radius:8px;color:var(--text-muted);font-size:0.8rem;font-family:inherit;cursor:pointer;transition:color 0.15s,border-color 0.15s}
        .sl-toggle-btn:hover{color:var(--text-secondary);border-color:rgba(255,255,255,0.2)}
        .sl-empty{text-align:center;padding:56px 24px;color:var(--text-muted)}
        .sl-empty h3{font-size:0.95rem;color:var(--text-secondary);margin:0 0 6px;font-weight:600}
        .sl-empty p{font-size:0.82rem;margin:0}
        .sl-skeleton{display:flex;flex-direction:column;gap:4px}
        .sl-skeleton__row{height:46px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;animation:sl-pulse 1.4s ease-in-out infinite}
        @keyframes sl-pulse{0%,100%{opacity:.5}50%{opacity:.9}}
        @media(max-width:640px){
          .shopping-list{padding:20px 14px}
          .sl-item{grid-template-columns:26px 1fr;grid-template-rows:auto auto;gap:4px 10px;padding:12px}
          .sl-item .sl-checkbox{grid-row:1/3;align-self:center}
          .sl-item .sl-item__name{grid-column:2;grid-row:1}
          .sl-item .sl-item__row2{grid-column:2;grid-row:2;justify-content:flex-start;flex-wrap:wrap}
          .sl-progress{flex-direction:column;align-items:flex-start;gap:8px}
          .sl-progress__bar{width:100%}
          .sl-progress__text{white-space:normal}
        }
      `}</style>
      <div className="shopping-list">
        {/* Header */}
        <div className="sl-header">
          <div>
            <h1 className="sl-title">Lista de Compras</h1>
            <p className="sl-subtitle">Basado en tus compras habituales</p>
          </div>
          <select
            className="sl-history-select"
            value={historyMonths}
            onChange={(e) =>
              setHistoryMonths(Number(e.target.value) as 3 | 6 | 12)
            }
          >
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
          </select>
        </div>

        {/* Progress bar */}
        {!loading && filtered.length > 0 && (
          <div className="sl-progress">
            <span className="sl-progress__text">
              <strong>{bought.length}</strong> de{" "}
              <strong>{filtered.length}</strong> productos comprados este mes
            </span>
            <div className="sl-progress__bar">
              <div
                className="sl-progress__fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="sl-progress__pct">{progressPct}%</span>
          </div>
        )}

        {/* Category chips */}
        <div className="sl-chips">
          {SHOPPING_CATEGORIES.map((cat) => {
            const color = CATEGORY_COLORS[cat];
            const active = activeCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                className="sl-chip"
                data-active={String(active)}
                style={
                  {
                    "--cat-color": color,
                    "--cat-bg": hexToRgba(color, 0.14),
                  } as React.CSSProperties
                }
                onClick={() => toggleCategory(cat)}
              >
                <span className="sl-chip__dot" />
                {cat}
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div className="sl-controls">
          <select
            className="sl-select"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          >
            <option value={1}>Cualquier frecuencia</option>
            <option value={2}>Mín. 2 meses</option>
            <option value={3}>Mín. 3 meses</option>
          </select>
          <div className="sl-search-wrap">
            <span className="sl-search-icon">
              <Search size={14} />
            </span>
            <input
              className="sl-search"
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="sl-skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="sl-skeleton__row"
                style={{ animationDelay: `${i * 0.07}s` }}
              />
            ))}
          </div>
        )}

        {/* Content */}
        {!loading && (
          <>
            {/* To buy section */}
            <div className="sl-section">
              <div className="sl-section-label">
                Por comprar
                <span className="sl-section-count">{toBuy.length}</span>
              </div>
              {toBuy.length === 0 ? (
                <div className="sl-empty">
                  <ShoppingCart
                    size={40}
                    style={{
                      opacity: 0.2,
                      display: "block",
                      margin: "0 auto 12px",
                    }}
                  />
                  <h3>
                    {filtered.length === 0
                      ? "Sin resultados"
                      : "¡Todo al día!"}
                  </h3>
                  <p>
                    {filtered.length === 0
                      ? "No hay productos habituales con los filtros actuales"
                      : "Ya compraste todos tus productos habituales este mes"}
                  </p>
                </div>
              ) : (
                <div className="sl-list">
                  {toBuy.map((item) => (
                    <ShoppingItemRow
                      key={item.key}
                      item={item}
                      historyMonths={historyMonths}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Already bought section */}
            {bought.length > 0 && (
              <div className="sl-section">
                <button
                  type="button"
                  className="sl-toggle-btn"
                  onClick={() => setShowBought((v) => !v)}
                >
                  <Check size={14} />
                  {showBought ? "Ocultar" : "Mostrar"} {bought.length}{" "}
                  producto{bought.length !== 1 ? "s" : ""} ya comprado
                  {bought.length !== 1 ? "s" : ""}
                  {showBought ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
                {showBought && (
                  <div className="sl-list" style={{ marginTop: 8 }}>
                    {bought.map((item) => (
                      <ShoppingItemRow
                        key={item.key}
                        item={item}
                        historyMonths={historyMonths}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
