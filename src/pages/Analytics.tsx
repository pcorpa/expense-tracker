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
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { getAllGroups } from "../api/groups";
import { getAnalyticsData } from "../api/analytics";
import type { TransactionItem, Vendor } from "../types";

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

const TAB_IDS: Tab[] = ["overview", "trends", "products", "anomalies", "pareto", "groups", "export"];

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
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [vendorGrouping, setVendorGrouping] = useState<"canonical" | "raw">("canonical");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const { data: allGroups = [] } = useQuery({
    queryKey: ["all-groups"],
    queryFn: getAllGroups,
    enabled: Boolean(user),
  });
  const groupIds = allGroups.map((g) => g.id);

  const { data: analyticsData, isLoading: loading } = useQuery({
    queryKey: ["analytics-data", groupIds],
    queryFn: () => getAnalyticsData(groupIds),
    enabled: groupIds.length > 0,
  });
  const transactions = analyticsData?.transactions ?? [];
  const vendors = analyticsData?.vendors ?? [];
  const profileMap = analyticsData?.profileMap ?? {};

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
  const vendorById = useMemo(() => {
    const map = new Map<string, Vendor>();
    for (const v of vendors) map.set(v.id, v);
    return map;
  }, [vendors]);

  const vendorPareto = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      let label: string;
      if (vendorGrouping === "canonical" && t.vendor_id) {
        label = vendorById.get(t.vendor_id)?.canonical_name ?? t.vendor_or_source ?? "Unknown";
      } else {
        label = t.vendor_or_source ?? "Unknown";
      }
      map[label] = (map[label] ?? 0) + (t.total_amount ?? 0);
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
  }, [transactions, vendorGrouping, vendorById]);

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
          ? `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || profile.email
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
          <p className="eyebrow">{t("analytics.eyebrow")}</p>
          <h1>{t("analytics.loadingTitle")}</h1>
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
          <p className="eyebrow">{t("analytics.eyebrow")}</p>
          <h1>{t("analytics.title")}</h1>
          <p>
            {t("analytics.subtitle", { count: transactions.length, categories: categorySpend.length })}
          </p>
        </div>
      </div>

      <div className="analytics-tabs">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`analytics-tab${activeTab === id ? " active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {t(`analytics.${id}`)}
          </button>
        ))}
      </div>

      {!hasData && (
        <div className="content-block" style={{ marginTop: 16 }}>
          <p className="muted">
            {t("analytics.noData")}
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
                  <span className="kpi-label">{t("analytics.totalSpend")}</span>
                  <span className="kpi-value">${totalSpend.toFixed(2)}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">{t("analytics.numTransactions")}</span>
                  <span className="kpi-value">{transactions.length}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">{t("analytics.avgTransaction")}</span>
                  <span className="kpi-value">${avgPerTransaction.toFixed(2)}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">{t("analytics.topCategory")}</span>
                  <span className="kpi-value kpi-value--sm">
                    {categorySpend[0]?.name ?? "—"}
                  </span>
                </div>
              </div>

              <div className="chart-grid">
                <div className="content-block chart-block">
                  <h3 className="chart-title">{t("analytics.spendByCategory")}</h3>
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
                        formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, t("analytics.spend")]}
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "#f0f6fc" }}
                        itemStyle={{ color: "#8b949e" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="content-block chart-block">
                  <h3 className="chart-title">{t("analytics.categoryBreakdown")}</h3>
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
                        formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, t("analytics.spend")]}
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
                <h3 className="chart-title">{t("analytics.expensesOverTime")}</h3>
                <p className="chart-subtitle">
                  {t("analytics.expensesOverTimeDesc")}
                </p>

                {/* Category filter pills */}
                <div className="category-filters">
                  <button
                    type="button"
                    className={`cat-pill cat-pill--all${selectedCategories.size === activeCategories.length ? " active" : ""}`}
                    onClick={toggleAll}
                  >
                    {t("analytics.all")}
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
                      ? t("analytics.selectOneCategory")
                      : t("analytics.needMoreDates")}
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
                <h3 className="chart-title">{t("analytics.dailyTotalMA")}</h3>
                <p className="chart-subtitle">
                  {t("analytics.dailyTotalMADesc")}
                </p>
                {trendsData.length < 2 ? (
                  <p className="muted">
                    {t("analytics.needTwoTransactions")}
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
                        name={t("analytics.dailyTotal")}
                        strokeWidth={1.5}
                        strokeOpacity={0.45}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma7"
                        stroke="#34d399"
                        dot={false}
                        name={t("analytics.ma7")}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma30"
                        stroke="#f59e0b"
                        dot={false}
                        name={t("analytics.ma30")}
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
              <h3 className="chart-title">{t("analytics.priceHistory")}</h3>
              <p className="chart-subtitle">
                {t("analytics.priceHistoryDesc")}
              </p>
              {productNames.length === 0 ? (
                <p className="muted">{t("analytics.noProductData")}</p>
              ) : (
                <>
                  <div style={{ marginBottom: 24 }}>
                    <label>
                      {t("analytics.productLabel")}
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
                      {t("analytics.onlyOnePurchase")}
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
                            name === "unit_price" ? t("analytics.unitPrice") : String(name),
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
              <h3 className="chart-title">{t("analytics.anomalyDetection")}</h3>
              <p className="chart-subtitle">
                {t("analytics.anomalyDetectionDesc")}
              </p>
              {anomalies.length === 0 ? (
                <p className="muted" style={{ marginTop: 16 }}>
                  {t("analytics.noAnomalies")}
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
                          {item.transactionVendor ?? t("analytics.unknown")}
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
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
                <div>
                  <h3 className="chart-title" style={{ margin: 0 }}>{t("analytics.paretoTitle")}</h3>
                  <p className="chart-subtitle">
                    {t("analytics.paretoDesc")}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 0, borderRadius: 7, overflow: "hidden", border: "1px solid var(--border-color)", flexShrink: 0, alignSelf: "flex-start" }}>
                  {(["canonical", "raw"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setVendorGrouping(mode)}
                      style={{
                        padding: "6px 13px",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                        background: vendorGrouping === mode ? "var(--color-accent)" : "var(--bg-secondary)",
                        color: vendorGrouping === mode ? "#fff" : "var(--text-secondary)",
                        transition: "background 0.15s",
                      }}
                    >
                      {mode === "canonical" ? t("analytics.canonical") : t("analytics.rawName")}
                    </button>
                  ))}
                </div>
              </div>
              {vendorPareto.length === 0 ? (
                <p className="muted">{t("analytics.noVendorData")}</p>
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
                            ? [`${value}%`, t("analytics.cumulativePct")]
                            : [`$${Number(value).toFixed(2)}`, t("analytics.spend")]
                        }
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="total"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                        name={t("analytics.spend")}
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
                          {under80.length} {under80.length !== 1 ? t("nav.vendor") : t("nav.vendor")}
                        </strong>{" "}
                        ({topPct}% {t("analytics.percentOfTotal")}) account for ≈80% {t("analytics.totalSpendLabel")}.
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
              <h3 className="chart-title">{t("analytics.groupsTitle")}</h3>
              <p className="chart-subtitle">
                {t("analytics.groupsDesc")}
              </p>
              {memberSpend.length === 0 ? (
                <p className="muted">{t("analytics.noMemberData")}</p>
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
                          t("analytics.totalSpendLabel"),
                        ]}
                      />
                      <Bar
                        dataKey="total"
                        fill="#818cf8"
                        radius={[4, 4, 0, 0]}
                        name={t("analytics.totalSpendLabel")}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="member-list">
                    {memberSpend.map((m) => (
                      <div key={m.userId} className="member-row">
                        <span className="member-row__name">{m.name}</span>
                        <div className="member-row__stats">
                          <span className="small-text muted">
                            {Math.round((m.total / totalSpend) * 100)}% {t("analytics.percentOfTotal")}
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
              <h3 className="chart-title">{t("analytics.exportTitle")}</h3>
              <p className="chart-subtitle">
                {t("analytics.exportDesc")}
              </p>
              <div className="export-actions">
                <button type="button" className="button" onClick={exportCSV}>
                  <Download size={15} />
                  {t("analytics.downloadCSV", { count: allItems.length })}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={exportJSON}
                >
                  <Download size={15} />
                  {t("analytics.downloadJSON", { count: transactions.length })}
                </button>
              </div>
              <div className="export-info">
                <p className="small-text muted">
                  <strong>CSV:</strong> {t("analytics.csvDesc")}
                </p>
                <p className="small-text muted">
                  <strong>JSON:</strong> {t("analytics.jsonDesc")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default Analytics;
