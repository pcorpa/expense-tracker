import { useState, useEffect, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
  ComposedChart,
} from "recharts";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Transaction, TransactionItem } from "../types";

const CATEGORY_COLORS: Record<string, string> = {
  Comida: "#3b82f6",
  Limpieza: "#34d399",
  Salud: "#f59e0b",
  Entretenimiento: "#818cf8",
  Hogar: "#60a5fa",
  Transporte: "#f87171",
  Vestimenta: "#a78bfa",
  Restaurante: "#fb923c",
  "Cuidado Personal": "#e879f9",
  Mascotas: "#4ade80",
  Servicios: "#94a3b8",
  Educación: "#67e8f9",
  Tecnología: "#facc15",
  Otro: "#6b7280",
};

type Tab =
  | "overview"
  | "trends"
  | "products"
  | "anomalies"
  | "pareto"
  | "groups"
  | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "products", label: "Products" },
  { id: "anomalies", label: "Anomalies" },
  { id: "pareto", label: "Pareto" },
  { id: "groups", label: "Groups" },
  { id: "export", label: "Export" },
];

type EnrichedItem = TransactionItem & {
  transactionDate: string | null;
  transactionVendor: string | null;
  transactionId: string;
  currency: string;
};

const TOOLTIP_STYLE = {
  background: "#161b22",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
};

export function Analytics() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileMap, setProfileMap] = useState<
    Record<string, { first_name: string | null; last_name: string | null; email: string }>
  >({});
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function fetchData() {
    setLoading(true);

    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user!.id);

    if (!memberships?.length) {
      setLoading(false);
      return;
    }

    const groupIds = memberships.map((m) => m.group_id);

    const [{ data: txData }, { data: memberRows }] = await Promise.all([
      supabase
        .from("transactions")
        .select("*, transaction_items(*)")
        .in("group_id", groupIds)
        .eq("is_reviewed", true)
        .eq("type", "expense")
        .order("date", { ascending: true }),
      supabase
        .from("group_members")
        .select("user_id")
        .in("group_id", groupIds),
    ]);

    setTransactions(txData ?? []);

    // Fetch profiles separately — group_members.user_id → auth.users, not profiles directly
    const userIds = [...new Set((memberRows ?? []).map((m) => m.user_id))];
    if (userIds.length) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", userIds);
      const map: typeof profileMap = {};
      for (const p of profileRows ?? []) {
        map[p.id] = { first_name: p.first_name, last_name: p.last_name, email: p.email };
      }
      setProfileMap(map);
    }
    setLoading(false);
  }

  const allItems = useMemo<EnrichedItem[]>(
    () =>
      transactions.flatMap((t) =>
        (t.transaction_items ?? []).map((item) => ({
          ...item,
          transactionDate: t.date,
          transactionVendor: t.vendor_or_source,
          transactionId: t.id,
          currency: t.currency,
        }))
      ),
    [transactions]
  );

  // --- OVERVIEW ---
  const categorySpend = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of allItems) {
      const cat = item.category ?? "Otro";
      map[cat] = (map[cat] ?? 0) + (item.item_total ?? 0);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
  }, [allItems]);

  const totalSpend = useMemo(
    () => transactions.reduce((s, t) => s + (t.total_amount ?? 0), 0),
    [transactions]
  );

  const avgPerTransaction = transactions.length
    ? totalSpend / transactions.length
    : 0;

  // --- TRENDS: Daily spend + moving averages ---
  const trendsData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      if (!t.date) continue;
      const date = t.date.slice(0, 10);
      map[date] = (map[date] ?? 0) + (t.total_amount ?? 0);
    }
    const daily = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }));

    return daily.map((d, i) => {
      const w7 = daily.slice(Math.max(0, i - 6), i + 1);
      const w30 = daily.slice(Math.max(0, i - 29), i + 1);
      return {
        ...d,
        ma7: Math.round((w7.reduce((s, x) => s + x.total, 0) / w7.length) * 100) / 100,
        ma30: Math.round((w30.reduce((s, x) => s + x.total, 0) / w30.length) * 100) / 100,
      };
    });
  }, [transactions]);

  // --- TRENDS: Categories over time ---
  const activeCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of allItems) cats.add(item.category ?? "Otro");
    return Array.from(cats).sort();
  }, [allItems]);

  // Initialise selection once categories are known
  useEffect(() => {
    if (activeCategories.length && selectedCategories.size === 0) {
      setSelectedCategories(new Set(activeCategories));
    }
  }, [activeCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  function toggleAll() {
    setSelectedCategories((prev) =>
      prev.size === activeCategories.length ? new Set() : new Set(activeCategories)
    );
  }

  const categoryTrendsData = useMemo(() => {
    if (!selectedCategories.size) return [];
    // Collect all dates
    const dateSet = new Set<string>();
    for (const item of allItems) {
      if (item.transactionDate) dateSet.add(item.transactionDate.slice(0, 10));
    }
    const dates = Array.from(dateSet).sort();

    // For each date sum item_total per selected category
    return dates.map((date) => {
      const row: Record<string, unknown> = { date };
      for (const cat of selectedCategories) {
        row[cat] = Math.round(
          allItems
            .filter(
              (i) =>
                i.transactionDate?.slice(0, 10) === date &&
                (i.category ?? "Otro") === cat
            )
            .reduce((s, i) => s + (i.item_total ?? 0), 0) * 100
        ) / 100;
      }
      return row;
    });
  }, [allItems, selectedCategories]);

  // --- PRODUCTS: Price history ---
  const productNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of allItems) {
      if (item.name) names.add(item.name);
    }
    return Array.from(names).sort();
  }, [allItems]);

  useEffect(() => {
    if (productNames.length && !selectedProduct) {
      setSelectedProduct(productNames[0]);
    }
  }, [productNames, selectedProduct]);

  const productPriceHistory = useMemo(() => {
    if (!selectedProduct) return [];
    return allItems
      .filter(
        (item) =>
          item.name === selectedProduct &&
          item.unit_price != null &&
          item.transactionDate
      )
      .sort((a, b) =>
        (a.transactionDate ?? "").localeCompare(b.transactionDate ?? "")
      )
      .map((item) => ({
        date: item.transactionDate?.slice(0, 10) ?? "",
        unit_price: item.unit_price,
        vendor: item.transactionVendor ?? "Unknown",
      }));
  }, [allItems, selectedProduct]);

  // --- ANOMALIES ---
  const anomalies = useMemo(() => {
    const byCategory: Record<string, number[]> = {};
    for (const item of allItems) {
      const cat = item.category ?? "Otro";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item.item_total ?? 0);
    }

    const stats: Record<string, { mean: number; std: number }> = {};
    for (const [cat, values] of Object.entries(byCategory)) {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      stats[cat] = { mean, std: Math.sqrt(variance) };
    }

    return allItems
      .filter((item) => {
        const cat = item.category ?? "Otro";
        const s = stats[cat];
        return s && s.std > 0 && Math.abs((item.item_total ?? 0) - s.mean) > 2 * s.std;
      })
      .map((item) => {
        const cat = item.category ?? "Otro";
        const s = stats[cat];
        return {
          ...item,
          zScore: Math.abs(((item.item_total ?? 0) - s.mean) / s.std),
          categoryMean: s.mean,
        };
      })
      .sort((a, b) => b.zScore - a.zScore);
  }, [allItems]);

  // --- PARETO ---
  const vendorPareto = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      const vendor = t.vendor_or_source ?? "Unknown";
      map[vendor] = (map[vendor] ?? 0) + (t.total_amount ?? 0);
    }
    const sorted = Object.entries(map)
      .map(([vendor, total]) => ({ vendor, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const grandTotal = sorted.reduce((s, v) => s + v.total, 0);
    let cumulative = 0;
    return sorted.map((v) => {
      cumulative += v.total;
      return { ...v, cumPct: Math.round((cumulative / grandTotal) * 100) };
    });
  }, [transactions]);

  // --- GROUPS ---
  const memberSpend = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      map[t.user_id] = (map[t.user_id] ?? 0) + (t.total_amount ?? 0);
    }
    return Object.entries(map)
      .map(([userId, total]) => {
        const profile = profileMap[userId];
        const name = profile
          ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.email
          : `${userId.slice(0, 8)}…`;
        return { name, total: Math.round(total * 100) / 100, userId };
      })
      .sort((a, b) => b.total - a.total);
  }, [transactions, profileMap]);

  // --- EXPORT ---
  function exportCSV() {
    const header = ["transaction_id", "date", "vendor", "category", "item_name", "quantity", "unit_price", "item_total", "currency"];
    const rows = allItems.map((item) => [
      item.transactionId,
      item.transactionDate ?? "",
      item.transactionVendor ?? "",
      item.category ?? "",
      item.name ?? "",
      item.quantity ?? "",
      item.unit_price ?? "",
      item.item_total ?? "",
      item.currency ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    triggerDownload(csv, "expenses.csv", "text/csv");
  }

  function exportJSON() {
    const data = transactions.map((t) => ({
      id: t.id,
      date: t.date,
      vendor: t.vendor_or_source,
      total_amount: t.total_amount,
      currency: t.currency,
      items: t.transaction_items?.map((item) => ({
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        unit_price: item.unit_price,
        item_total: item.item_total,
      })),
    }));
    triggerDownload(JSON.stringify(data, null, 2), "expenses.json", "application/json");
  }

  function triggerDownload(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <main className="page">
        <div className="page__header">
          <p className="eyebrow">Analytics</p>
          <h1>Statistical Dashboard</h1>
        </div>
        <div className="content-block">
          <div className="skeleton-loader">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
          </div>
        </div>
      </main>
    );
  }

  const hasData = transactions.length > 0;

  return (
    <main className="page analytics-page">
      <div className="page__header">
        <div>
          <p className="eyebrow">Phase 3</p>
          <h1>Statistical Analytics</h1>
          <p>
            Insights from {transactions.length} reviewed transaction
            {transactions.length !== 1 ? "s" : ""} across {categorySpend.length}{" "}
            categor{categorySpend.length !== 1 ? "ies" : "y"}.
          </p>
        </div>
      </div>

      <div className="analytics-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`analytics-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!hasData && (
        <div className="content-block" style={{ marginTop: 16 }}>
          <p className="muted">
            No reviewed expenses found. Approve transactions in the Review Queue first.
          </p>
        </div>
      )}

      {hasData && (
        <div className="analytics-content">
          {/* ── OVERVIEW ── */}
          {activeTab === "overview" && (
            <>
              <div className="kpi-row">
                <div className="kpi-card">
                  <span className="kpi-label">Total Spend</span>
                  <span className="kpi-value">${totalSpend.toFixed(2)}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Transactions</span>
                  <span className="kpi-value">{transactions.length}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Avg / Transaction</span>
                  <span className="kpi-value">${avgPerTransaction.toFixed(2)}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Top Category</span>
                  <span className="kpi-value kpi-value--sm">
                    {categorySpend[0]?.name ?? "—"}
                  </span>
                </div>
              </div>

              <div className="chart-grid">
                <div className="content-block chart-block">
                  <h3 className="chart-title">Spend by Category</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={categorySpend}
                        cx="50%"
                        cy="50%"
                        outerRadius={110}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }: { name?: string; percent?: number }) =>
                          (percent ?? 0) > 0.04
                            ? `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`
                            : ""
                        }
                        labelLine={false}
                      >
                        {categorySpend.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={CATEGORY_COLORS[entry.name] ?? "#6b7280"}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, "Spend"]}
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc" }}
                        itemStyle={{ color: "#8b949e" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="content-block chart-block">
                  <h3 className="chart-title">Category Breakdown</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={categorySpend}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        type="number"
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={110}
                      />
                      <Tooltip
                        formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, "Spend"]}
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc" }}
                        itemStyle={{ color: "#8b949e" }}
                      />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {categorySpend.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={CATEGORY_COLORS[entry.name] ?? "#6b7280"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

          {/* ── TRENDS ── */}
          {activeTab === "trends" && (
            <>
              {/* Category over-time chart */}
              <div className="content-block">
                <h3 className="chart-title">Expenses Over Time by Category</h3>
                <p className="chart-subtitle">
                  Daily spend per item category. Toggle categories to compare.
                </p>

                {/* Category filter pills */}
                <div className="category-filters">
                  <button
                    type="button"
                    className={`cat-pill cat-pill--all${selectedCategories.size === activeCategories.length ? " active" : ""}`}
                    onClick={toggleAll}
                  >
                    All
                  </button>
                  {activeCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`cat-pill${selectedCategories.has(cat) ? " active" : ""}`}
                      style={
                        selectedCategories.has(cat)
                          ? {
                              borderColor: CATEGORY_COLORS[cat] ?? "#6b7280",
                              color: CATEGORY_COLORS[cat] ?? "#6b7280",
                              background: `${CATEGORY_COLORS[cat] ?? "#6b7280"}18`,
                            }
                          : undefined
                      }
                      onClick={() => toggleCategory(cat)}
                    >
                      <span
                        className="cat-pill__dot"
                        style={{ background: CATEGORY_COLORS[cat] ?? "#6b7280" }}
                      />
                      {cat}
                    </button>
                  ))}
                </div>

                {categoryTrendsData.length < 2 || !selectedCategories.size ? (
                  <p className="muted" style={{ marginTop: 12 }}>
                    {!selectedCategories.size
                      ? "Select at least one category."
                      : "Need at least 2 dates with data to show a trend."}
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart
                      data={categoryTrendsData}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#8b949e", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc", fontWeight: 600, marginBottom: 4 }}
                        itemStyle={{ color: "#8b949e" }}
                        formatter={(value: unknown) =>
                          Number(value) === 0 ? null : [`$${Number(value).toFixed(2)}`]
                        }
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 16, color: "#8b949e", fontSize: 12 }}
                      />
                      {Array.from(selectedCategories).map((cat) => (
                        <Line
                          key={cat}
                          type="monotone"
                          dataKey={cat}
                          stroke={CATEGORY_COLORS[cat] ?? "#6b7280"}
                          dot={categoryTrendsData.length < 20}
                          strokeWidth={2}
                          connectNulls={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Moving averages (total) */}
              <div className="content-block">
                <h3 className="chart-title">Daily Total with Moving Averages</h3>
                <p className="chart-subtitle">
                  7-day and 30-day moving averages smooth day-to-day noise.
                </p>
                {trendsData.length < 2 ? (
                  <p className="muted">
                    Need at least 2 transactions with dates.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={trendsData}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#8b949e", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc" }}
                        itemStyle={{ color: "#8b949e" }}
                        formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`]}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 16, color: "#8b949e", fontSize: 12 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#3b82f6"
                        dot={false}
                        name="Daily Total"
                        strokeWidth={1.5}
                        strokeOpacity={0.45}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma7"
                        stroke="#34d399"
                        dot={false}
                        name="7-Day MA"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma30"
                        stroke="#f59e0b"
                        dot={false}
                        name="30-Day MA"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>
          )}

          {/* ── PRODUCTS ── */}
          {activeTab === "products" && (
            <div className="content-block">
              <h3 className="chart-title">Product Price History — Inflation Index</h3>
              <p className="chart-subtitle">
                Track how the unit price of a specific product evolved over time.
              </p>
              {productNames.length === 0 ? (
                <p className="muted">No product data available.</p>
              ) : (
                <>
                  <div style={{ marginBottom: 24 }}>
                    <label>
                      Product
                      <select
                        value={selectedProduct}
                        onChange={(e) => setSelectedProduct(e.target.value)}
                        style={{ maxWidth: 340 }}
                      >
                        {productNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {productPriceHistory.length < 2 ? (
                    <p className="muted">
                      Only one purchase found for this product — need more data to
                      show price trends.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={productPriceHistory}
                        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="rgba(255,255,255,0.05)"
                        />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#8b949e", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: "#8b949e", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `$${v}`}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          labelStyle={{ color: "#f0f6fc" }}
                          itemStyle={{ color: "#8b949e" }}
                          formatter={(value: unknown, name: unknown) => [
                            `$${Number(value).toFixed(2)}`,
                            name === "unit_price" ? "Unit Price" : String(name),
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="unit_price"
                          stroke="#818cf8"
                          dot={{ fill: "#818cf8", r: 4 }}
                          name="unit_price"
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── ANOMALIES ── */}
          {activeTab === "anomalies" && (
            <div className="content-block">
              <h3 className="chart-title">Anomaly Detection</h3>
              <p className="chart-subtitle">
                Items priced more than 2 standard deviations from their category
                mean — potential pricing errors or unusual spending spikes.
              </p>
              {anomalies.length === 0 ? (
                <p className="muted" style={{ marginTop: 16 }}>
                  No anomalies detected — all items are within normal ranges.
                </p>
              ) : (
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  {anomalies.map((item) => (
                    <div key={item.id} className="anomaly-row">
                      <div className="anomaly-row__info">
                        <span className="anomaly-row__name">
                          {item.name || "Unnamed"}
                        </span>
                        <span className="item-row-btn__category">
                          {item.category ?? "Otro"}
                        </span>
                        <span className="small-text muted">
                          {item.transactionDate?.slice(0, 10)} ·{" "}
                          {item.transactionVendor ?? "Unknown"}
                        </span>
                      </div>
                      <div className="anomaly-row__stats">
                        <span className="anomaly-value">
                          ${(item.item_total ?? 0).toFixed(2)}
                        </span>
                        <span className="anomaly-z">z = {item.zScore.toFixed(1)}</span>
                        <span className="small-text muted">
                          avg ${item.categoryMean.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PARETO ── */}
          {activeTab === "pareto" && (
            <div className="content-block">
              <h3 className="chart-title">Pareto Analysis — 80/20 Rule</h3>
              <p className="chart-subtitle">
                Identify the vendors responsible for the majority of your total spend.
              </p>
              {vendorPareto.length === 0 ? (
                <p className="muted">No vendor data available.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart
                      data={vendorPareto.slice(0, 20)}
                      margin={{ top: 10, right: 40, left: 0, bottom: 48 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="vendor"
                        tick={{ fill: "#8b949e", fontSize: 10, textAnchor: "end" }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                        angle={-40}
                        height={56}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        domain={[0, 100]}
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc" }}
                        itemStyle={{ color: "#8b949e" }}
                        formatter={(value: unknown, name: unknown) =>
                          name === "cumPct"
                            ? [`${value}%`, "Cumulative %"]
                            : [`$${Number(value).toFixed(2)}`, "Spend"]
                        }
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="total"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                        name="Spend"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cumPct"
                        stroke="#f59e0b"
                        dot={false}
                        name="cumPct"
                        strokeWidth={2}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  {(() => {
                    const under80 = vendorPareto.filter((v) => v.cumPct <= 80);
                    const topPct = Math.round(
                      (under80.length / vendorPareto.length) * 100
                    );
                    return (
                      <p className="small-text" style={{ marginTop: 16 }}>
                        <strong style={{ color: "#f0f6fc" }}>
                          {under80.length} vendor
                          {under80.length !== 1 ? "s" : ""}
                        </strong>{" "}
                        ({topPct}% of vendors) account for ≈80% of total spend.
                      </p>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* ── GROUPS ── */}
          {activeTab === "groups" && (
            <div className="content-block">
              <h3 className="chart-title">Shared Finance Breakdown</h3>
              <p className="chart-subtitle">
                Contribution ratio per group member based on reviewed expenses.
              </p>
              {memberSpend.length === 0 ? (
                <p className="muted">No member data available.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={memberSpend}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc" }}
                        itemStyle={{ color: "#8b949e" }}
                        formatter={(value: unknown) => [
                          `$${Number(value).toFixed(2)}`,
                          "Total Spend",
                        ]}
                      />
                      <Bar
                        dataKey="total"
                        fill="#818cf8"
                        radius={[4, 4, 0, 0]}
                        name="Total Spend"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="member-list">
                    {memberSpend.map((m) => (
                      <div key={m.userId} className="member-row">
                        <span className="member-row__name">{m.name}</span>
                        <div className="member-row__stats">
                          <span className="small-text muted">
                            {Math.round((m.total / totalSpend) * 100)}% of total
                          </span>
                          <strong>${m.total.toFixed(2)}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── EXPORT ── */}
          {activeTab === "export" && (
            <div className="content-block">
              <h3 className="chart-title">Analytical Export</h3>
              <p className="chart-subtitle">
                Download reviewed expense data as flat CSV or structured JSON,
                optimized for external statistical tools.
              </p>
              <div className="export-actions">
                <button type="button" className="button" onClick={exportCSV}>
                  <Download size={15} />
                  Download CSV ({allItems.length} items)
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={exportJSON}
                >
                  <Download size={15} />
                  Download JSON ({transactions.length} transactions)
                </button>
              </div>
              <div className="export-info">
                <p className="small-text muted">
                  <strong>CSV:</strong> transaction_id, date, vendor, category,
                  item_name, quantity, unit_price, item_total, currency — one row per
                  item.
                </p>
                <p className="small-text muted">
                  <strong>JSON:</strong> Nested structure with transaction header and
                  items array, ready for R, Python, or any statistical environment.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
