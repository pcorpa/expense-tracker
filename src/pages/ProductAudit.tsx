import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScanSearch,
  CheckCircle2,
  Plus,
  ArrowRightLeft,
  Loader2,
  Package,
  AlertTriangle,
  Tag,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { runNormalizationPipeline } from "../lib/fuzzyMatch";
import type { MappingStatus, Product, ProductRawMapping } from "../types";

const CATEGORIES = [
  "Comida",
  "Limpieza",
  "Salud",
  "Entretenimiento",
  "Hogar",
  "Transporte",
  "Vestimenta",
  "Restaurante",
  "Cuidado Personal",
  "Mascotas",
  "Servicios",
  "Educación",
  "Tecnología",
  "Otro",
] as const;

// ─── types ────────────────────────────────────────────────────────────────────

type AuditItem = {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
  mapping_status: MappingStatus;
  suggested_product_id: string | null;
  transactions: { group_id: string };
  _similarity?: number;
};

type Cluster = {
  key: string;
  rawName: string;
  groupId: string;
  items: AuditItem[];
  canonicalName: string;
  category: string;
  similarity?: number;
};

// ─── data fetchers ────────────────────────────────────────────────────────────

async function fetchAuditItems(): Promise<AuditItem[]> {
  const { data, error } = await supabase
    .from("transaction_items")
    .select("id, name, category, quantity, unit_price, item_total, mapping_status, suggested_product_id, transactions!inner(group_id)")
    .in("mapping_status", ["needs_mapping_review", "new_product_candidate"])
    .order("name");
  if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
  return data as unknown as AuditItem[];
}

async function fetchAllProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, group_id, created_at")
    .order("name");
  if (error) {
    console.error("[ProductAudit] fetchAllProducts ERROR:", { message: error.message });
    return [];
  }
  return data as Product[];
}

async function fetchRawMappings(): Promise<ProductRawMapping[]> {
  const { data, error } = await supabase
    .from("product_raw_mappings")
    .select("id, group_id, raw_name, product_id, created_at")
    .order("raw_name");
  if (error) return [];
  return data as ProductRawMapping[];
}

async function fetchMyGroupRoles(): Promise<Record<string, "admin" | "member">> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from("group_members")
    .select("group_id, role")
    .eq("user_id", user.id);
  const map: Record<string, "admin" | "member"> = {};
  for (const row of data ?? []) map[row.group_id] = row.role;
  return map;
}

// ─── scan pipeline ────────────────────────────────────────────────────────────

async function runScan(): Promise<{ scanned: number; autoMatched: number; needsReview: number; newCandidates: number }> {
  const { data: rawItemsRaw, error: itemsErr } = await supabase
    .from("transaction_items")
    .select("id, name, transactions!inner(group_id)")
    .is("mapping_status", null)
    .is("product_id", null)
    .neq("name", "Unknown");

  if (itemsErr) throw itemsErr;
  if (!rawItemsRaw || rawItemsRaw.length === 0) return { scanned: 0, autoMatched: 0, needsReview: 0, newCandidates: 0 };

  const rawItems = rawItemsRaw as unknown as Array<{ id: string; name: string; transactions: { group_id: string } }>;
  const groupIds = [...new Set(rawItems.map((i) => i.transactions.group_id))];

  const [{ data: products, error: productsErr }, { data: rawMappings }] = await Promise.all([
    supabase.from("products").select("id, name, category, group_id, created_at"),
    supabase.from("product_raw_mappings").select("group_id, raw_name, product_id").in("group_id", groupIds),
  ]);

  if (productsErr) throw productsErr;

  // Build confirmed map: "groupId|rawNameLower" → productId
  const confirmedMap = new Map<string, string>();
  for (const m of rawMappings ?? []) {
    confirmedMap.set(`${m.group_id}|${m.raw_name.toLowerCase().trim()}`, m.product_id);
  }

  const autoMatchedByProduct = new Map<string, string[]>();
  const reviewByProduct = new Map<string, string[]>();
  const newCandidateIds: string[] = [];
  const fuzzyItems: Array<{ id: string; name: string }> = [];

  // Step 1: exact confirmed matches
  for (const item of rawItems) {
    const key = `${item.transactions.group_id}|${item.name.toLowerCase().trim()}`;
    const knownProductId = confirmedMap.get(key);
    if (knownProductId) {
      const ids = autoMatchedByProduct.get(knownProductId) ?? [];
      ids.push(item.id);
      autoMatchedByProduct.set(knownProductId, ids);
    } else {
      fuzzyItems.push({ id: item.id, name: item.name });
    }
  }

  // Step 2: fuzzy-match the rest
  const results = runNormalizationPipeline(fuzzyItems, (products ?? []) as Product[]);

  for (const r of results) {
    if (r.status === "auto_matched" && r.suggestedProductId) {
      const ids = autoMatchedByProduct.get(r.suggestedProductId) ?? [];
      ids.push(r.id);
      autoMatchedByProduct.set(r.suggestedProductId, ids);
    } else if (r.status === "needs_mapping_review" && r.suggestedProductId) {
      const ids = reviewByProduct.get(r.suggestedProductId) ?? [];
      ids.push(r.id);
      reviewByProduct.set(r.suggestedProductId, ids);
    } else {
      newCandidateIds.push(r.id);
    }
  }

  const updates: PromiseLike<unknown>[] = [];

  for (const [productId, ids] of autoMatchedByProduct) {
    updates.push(
      supabase
        .from("transaction_items")
        .update({ product_id: productId, mapping_status: "auto_matched", suggested_product_id: null })
        .in("id", ids),
    );
  }
  for (const [productId, ids] of reviewByProduct) {
    updates.push(
      supabase
        .from("transaction_items")
        .update({ mapping_status: "needs_mapping_review", suggested_product_id: productId })
        .in("id", ids),
    );
  }
  if (newCandidateIds.length > 0) {
    updates.push(
      supabase
        .from("transaction_items")
        .update({ mapping_status: "new_product_candidate" })
        .in("id", newCandidateIds),
    );
  }

  await Promise.all(updates);

  const totalAutoMatched = [...autoMatchedByProduct.values()].reduce((s, ids) => s + ids.length, 0);
  return {
    scanned: rawItems.length,
    autoMatched: totalAutoMatched,
    needsReview: [...reviewByProduct.values()].reduce((s, ids) => s + ids.length, 0),
    newCandidates: newCandidateIds.length,
  };
}

// ─── combobox component ────────────────────────────────────────────────────────

function ProductCombobox({
  value,
  onChange,
  onSelect,
  products,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (product: Product) => void;
  products: Product[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return products.slice(0, 8);
    const q = value.toLowerCase();
    return products.filter((p) => {
      const name = p.name.toLowerCase();
      if (name.includes(q) || q.includes(name)) return true;
      return name.split(/[\s\W]+/).filter((w) => w.length >= 3).some((token) => q.includes(token));
    }).slice(0, 8);
  }, [value, products]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", flex: "2 1 200px" }}>
      <label style={labelStyle}>Canonical name</label>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={inputStyle}
        placeholder={placeholder ?? "Type or select existing product…"}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: 7,
          marginTop: 3,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(p);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "8px 12px",
                fontSize: "0.85rem",
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <Package size={13} color="var(--text-muted)" />
              <span style={{ flex: 1 }}>{p.name}</span>
              {p.category && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{p.category}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export function ProductAudit() {
  const qc = useQueryClient();

  const auditQuery = useQuery({ queryKey: ["audit-items"], queryFn: fetchAuditItems, retry: false });
  const productsQuery = useQuery({ queryKey: ["all-products"], queryFn: fetchAllProducts, retry: false });
  const rawMappingsQuery = useQuery({ queryKey: ["product-raw-mappings"], queryFn: fetchRawMappings, retry: false });
  const rolesQuery = useQuery({ queryKey: ["my-group-roles"], queryFn: fetchMyGroupRoles });

  const auditError = auditQuery.error as (Error & { code?: string }) | null;
  const isMigrationNeeded =
    auditQuery.isError &&
    (auditError?.code === "42703" ||
      auditError?.message?.toLowerCase().includes("column") ||
      auditError?.message?.toLowerCase().includes("does not exist") ||
      auditQuery.isError);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of productsQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [productsQuery.data]);

  const isAdminOf = useCallback(
    (groupId: string) => rolesQuery.data?.[groupId] === "admin",
    [rolesQuery.data],
  );

  // ── scan ──────────────────────────────────────────────────────────────────

  const scanMutation = useMutation({
    mutationFn: runScan,
    onSuccess: (stats) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["all-products"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      if (stats.scanned === 0) {
        toast.info("No unprocessed items found.");
      } else {
        toast.success(
          `Scanned ${stats.scanned} items — ${stats.autoMatched} auto-matched, ${stats.needsReview} need review, ${stats.newCandidates} new candidates.`,
        );
      }
    },
    onError: (err: Error) => toast.error(`Scan failed: ${err.message}`),
  });

  // ── confirm potential match ───────────────────────────────────────────────

  const confirmMutation = useMutation({
    mutationFn: async ({ rawName, productId, groupId }: { rawName: string; productId: string; groupId: string }) => {
      const { error } = await supabase.rpc("confirm_product_match", {
        p_raw_name: rawName,
        p_product_id: productId,
        p_group_id: groupId,
      });
      if (error) throw error;
    },
    onSuccess: (_, { rawName }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      toast.success(`"${rawName}" confirmed.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── treat as new ─────────────────────────────────────────────────────────

  const treatAsNewMutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[]; rawName: string }) => {
      const { error } = await supabase
        .from("transaction_items")
        .update({ mapping_status: "new_product_candidate", suggested_product_id: null })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, { rawName }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      toast.info(`"${rawName}" moved to New Candidates.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── approve / map to existing product ────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: async ({
      rawName,
      canonicalName,
      category,
      groupId,
      existingProductId,
    }: {
      rawName: string;
      canonicalName: string;
      category: string;
      groupId: string;
      existingProductId: string | null;
    }) => {
      if (existingProductId) {
        const { error } = await supabase.rpc("confirm_product_match", {
          p_raw_name: rawName,
          p_product_id: existingProductId,
          p_group_id: groupId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("approve_product_mapping", {
          p_raw_name: rawName,
          p_canonical_name: canonicalName.trim(),
          p_category: category,
          p_group_id: groupId,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, { canonicalName, existingProductId }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["all-products"] });
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      toast.success(existingProductId ? `Mapped to "${canonicalName}".` : `"${canonicalName}" added to catalog.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── product catalog: rename ───────────────────────────────────────────────

  const renameMutation = useMutation({
    mutationFn: async ({ productId, name, category }: { productId: string; name: string; category: string }) => {
      const { error } = await supabase.rpc("rename_product", {
        p_product_id: productId,
        p_canonical_name: name.trim(),
        p_category: category,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-products"] });
      setEditingProductId(null);
      toast.success("Product updated.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── product catalog: delete ───────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.rpc("delete_product", { p_product_id: productId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-products"] });
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      toast.success("Product deleted. Affected items will re-appear on next scan.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── delete raw mapping ────────────────────────────────────────────────────

  const deleteMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase.rpc("delete_product_raw_mapping", { p_mapping_id: mappingId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      toast.success("Mapping removed. Items with this raw name will re-appear in the audit queue on next scan.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── cluster state ─────────────────────────────────────────────────────────

  const [clusterEdits, setClusterEdits] = useState<Record<string, { canonicalName: string; category: string }>>({});
  const [clusterSelectedProduct, setClusterSelectedProduct] = useState<Record<string, Product | null>>({});
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  // catalog edit state
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productEditName, setProductEditName] = useState("");
  const [productEditCategory, setProductEditCategory] = useState("");

  const getClusterEdit = useCallback(
    (key: string, defaultName: string, defaultCat: string) =>
      clusterEdits[key] ?? { canonicalName: defaultName, category: defaultCat },
    [clusterEdits],
  );

  const setClusterField = useCallback(
    (key: string, field: "canonicalName" | "category", value: string, defaultName: string, defaultCat: string) => {
      setClusterEdits((prev) => ({
        ...prev,
        [key]: { ...getClusterEdit(key, defaultName, defaultCat), [field]: value },
      }));
      if (field === "canonicalName") {
        setClusterSelectedProduct((prev) => ({ ...prev, [key]: null }));
      }
    },
    [getClusterEdit],
  );

  const selectProduct = useCallback((key: string, product: Product) => {
    setClusterEdits((prev) => ({
      ...prev,
      [key]: { canonicalName: product.name, category: product.category ?? "Otro" },
    }));
    setClusterSelectedProduct((prev) => ({ ...prev, [key]: product }));
  }, []);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── live enrichment ───────────────────────────────────────────────────────

  const enrichedItems = useMemo<AuditItem[]>(() => {
    const rawItems = auditQuery.data ?? [];
    const products = productsQuery.data ?? [];
    if (!products.length || !rawItems.length) return rawItems;
    const results = runNormalizationPipeline(rawItems, products);
    const enrichMap = new Map(results.map((r) => [r.id, r]));
    return rawItems.map((item) => {
      const match = enrichMap.get(item.id);
      return {
        ...item,
        suggested_product_id: match?.suggestedProductId ?? item.suggested_product_id,
        _similarity: match?.similarity,
      };
    });
  }, [auditQuery.data, productsQuery.data]);

  // ── derive clusters ───────────────────────────────────────────────────────

  const potentialClusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const item of enrichedItems.filter((i) => i.mapping_status === "needs_mapping_review")) {
      const key = item.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { key, rawName: item.name, groupId: item.transactions.group_id, items: [], canonicalName: item.name, category: item.category ?? "Otro", similarity: item._similarity });
      }
      map.get(key)!.items.push(item);
    }
    return [...map.values()];
  }, [enrichedItems]);

  const newCandidateClusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const item of enrichedItems.filter((i) => i.mapping_status === "new_product_candidate")) {
      const key = item.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { key, rawName: item.name, groupId: item.transactions.group_id, items: [], canonicalName: item.name, category: item.category ?? "Otro" });
      }
      map.get(key)!.items.push(item);
    }
    return [...map.values()];
  }, [enrichedItems]);

  const isLoading = (auditQuery.isLoading || productsQuery.isLoading) && !isMigrationNeeded;
  const totalPending = potentialClusters.length + newCandidateClusters.length;
  const allProducts = productsQuery.data ?? [];
  const allMappings = rawMappingsQuery.data ?? [];

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Product Audit
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Map raw receipt text to your canonical product catalog for statistical consistency.
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending || isMigrationNeeded}
          style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, fontSize: "0.85rem", cursor: scanMutation.isPending ? "wait" : "pointer", flexShrink: 0, opacity: scanMutation.isPending ? 0.7 : 1 }}
        >
          {scanMutation.isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ScanSearch size={15} />}
          {scanMutation.isPending ? "Scanning…" : "Scan Unmapped Items"}
        </button>
      </div>

      {/* Migration banner */}
      {isMigrationNeeded && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "16px 18px", marginBottom: 24 }}>
          <AlertTriangle size={18} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--color-danger)", fontSize: "0.9rem" }}>Database migration required</p>
            <p style={{ margin: "0 0 10px", fontSize: "0.83rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Run migration <strong>0008_product_normalization.sql</strong> then <strong>0021_product_admin_controls.sql</strong> in your Supabase SQL editor, then reload.
            </p>
          </div>
        </div>
      )}

      {/* Stat chips */}
      {!isLoading && !isMigrationNeeded && (
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          <StatChip color="var(--color-accent)" label="Potential matches" count={potentialClusters.length} icon={<ArrowRightLeft size={14} />} />
          <StatChip color="#f59e0b" label="New candidates" count={newCandidateClusters.length} icon={<Plus size={14} />} />
          {totalPending === 0 && <StatChip color="var(--color-success)" label="All clear — nothing pending" count={null} icon={<CheckCircle2 size={14} />} />}
        </div>
      )}

      {isLoading && !isMigrationNeeded && (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ margin: 0, fontSize: "0.85rem" }}>Loading audit data…</p>
        </div>
      )}

      {/* ── Two-panel grid ──────────────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && (
        <div className="audit-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 28, alignItems: "start" }}>

          {/* ── LEFT: audit queue ──────────────────────────────────────── */}
          <div>
            {/* Potential Matches */}
            {potentialClusters.length > 0 && (
              <section style={{ marginBottom: 36 }}>
                <SectionHeader icon={<ArrowRightLeft size={16} />} title="Potential Matches" subtitle="Fuzzy score 60–90% — confirm or reclassify as new." color="var(--color-accent)" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {potentialClusters.map((cluster) => {
                    const suggestedProduct = cluster.items[0].suggested_product_id
                      ? productsById.get(cluster.items[0].suggested_product_id)
                      : null;
                    const isPending = confirmMutation.isPending || treatAsNewMutation.isPending;
                    const isExpanded = expandedClusters.has(cluster.key);
                    const isAdmin = isAdminOf(cluster.groupId);
                    return (
                      <div key={cluster.key} style={cardStyle}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <button onClick={() => toggleExpanded(cluster.key)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                              {isExpanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                              <Tag size={13} color="var(--text-muted)" />
                              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Raw name · {cluster.items.length} item{cluster.items.length !== 1 ? "s" : ""}
                              </span>
                            </button>
                            <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                              {cluster.rawName}
                            </p>
                            {suggestedProduct ? (
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 6, padding: "5px 10px", fontSize: "0.82rem" }}>
                                <Package size={13} color="var(--color-accent)" />
                                <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>{suggestedProduct.name}</span>
                                {suggestedProduct.category && <span style={{ color: "var(--text-muted)" }}>· {suggestedProduct.category}</span>}
                                {cluster.similarity !== undefined && (
                                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>· {Math.round(cluster.similarity * 100)}%</span>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Suggested product not found</span>
                            )}
                          </div>
                          {isAdmin ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
                              {suggestedProduct && (
                                <button disabled={isPending} onClick={() => confirmMutation.mutate({ rawName: cluster.rawName, productId: suggestedProduct.id, groupId: cluster.groupId })} style={primaryBtn}>
                                  <CheckCircle2 size={13} /> Confirm Match
                                </button>
                              )}
                              <button disabled={isPending} onClick={() => treatAsNewMutation.mutate({ ids: cluster.items.map((i) => i.id), rawName: cluster.rawName })} style={ghostBtn}>
                                <Plus size={13} /> Treat as New
                              </button>
                            </div>
                          ) : (
                            <p style={{ margin: 0, fontSize: "0.79rem", color: "var(--text-muted)" }}>Only admins can confirm.</p>
                          )}
                        </div>
                        {isExpanded && <TransactionItemList items={cluster.items} />}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* New Product Candidates */}
            {newCandidateClusters.length > 0 && (
              <section style={{ marginBottom: 36 }}>
                <SectionHeader icon={<Plus size={16} />} title="New Product Candidates" subtitle="No match found — type a canonical name or select an existing product." color="#f59e0b" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {newCandidateClusters.map((cluster) => {
                    const edit = getClusterEdit(cluster.key, cluster.rawName, cluster.category ?? "Otro");
                    const selectedProduct = clusterSelectedProduct[cluster.key] ?? null;
                    const isPending = approveMutation.isPending;
                    const isExpanded = expandedClusters.has(cluster.key);
                    const isAdmin = isAdminOf(cluster.groupId);
                    return (
                      <div key={cluster.key} style={cardStyle}>
                        <button onClick={() => toggleExpanded(cluster.key)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                          {isExpanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                          <Tag size={13} color="var(--text-muted)" />
                          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Raw name · {cluster.items.length} item{cluster.items.length !== 1 ? "s" : ""}
                          </span>
                        </button>
                        <p style={{ margin: "0 0 14px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                          {cluster.rawName}
                        </p>
                        {isAdmin ? (
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                            <ProductCombobox
                              value={edit.canonicalName}
                              onChange={(v) => setClusterField(cluster.key, "canonicalName", v, cluster.rawName, cluster.category ?? "Otro")}
                              onSelect={(p) => selectProduct(cluster.key, p)}
                              products={productsQuery.data ?? []}
                            />
                            <div style={{ flex: "1 1 140px" }}>
                              <label style={labelStyle}>Category</label>
                              <select
                                value={edit.category}
                                onChange={(e) => setClusterField(cluster.key, "category", e.target.value, cluster.rawName, cluster.category ?? "Otro")}
                                style={inputStyle}
                              >
                                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <button
                              disabled={isPending || !edit.canonicalName.trim()}
                              onClick={() => approveMutation.mutate({ rawName: cluster.rawName, canonicalName: edit.canonicalName, category: edit.category, groupId: cluster.groupId, existingProductId: selectedProduct?.id ?? null })}
                              style={{ ...primaryBtn, background: selectedProduct ? "var(--color-accent)" : "#f59e0b", alignSelf: "flex-end", opacity: isPending || !edit.canonicalName.trim() ? 0.5 : 1 }}
                            >
                              {selectedProduct
                                ? <><ArrowRightLeft size={13} /> Map to "{selectedProduct.name}"</>
                                : <><Plus size={13} /> Add to Catalog</>
                              }
                            </button>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>Only group admins can add products.</p>
                        )}
                        {isExpanded && <TransactionItemList items={cluster.items} />}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Empty state */}
            {totalPending === 0 && !scanMutation.isPending && (
              <div style={{ textAlign: "center", padding: "56px 24px", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
                <CheckCircle2 size={40} color="var(--color-success)" style={{ margin: "0 auto 14px" }} />
                <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>All items are mapped</p>
                <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
                  Click <strong>Scan Unmapped Items</strong> to check for new receipts that need normalization.
                </p>
              </div>
            )}
          </div>

          {/* ── RIGHT: catalog + mappings (sticky) ─────────────────────── */}
          <div style={{ position: "sticky", top: 24, maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>

            {/* Product Catalog */}
            {allProducts.length > 0 && (
              <section style={{ marginBottom: 24 }}>
                <SectionHeader
                  icon={<Package size={16} />}
                  title="Product Catalog"
                  subtitle={`${allProducts.length} canonical product${allProducts.length !== 1 ? "s" : ""}`}
                  color="var(--text-muted)"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {allProducts.map((product) => {
                    const isEditing = editingProductId === product.id;
                    const isAdmin = isAdminOf(product.group_id ?? "");
                    return (
                      <div key={product.id} style={{ ...cardStyle, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                        <Package size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        {isEditing ? (
                          <>
                            <input
                              value={productEditName}
                              onChange={(e) => setProductEditName(e.target.value)}
                              style={{ ...inputStyle, flex: 1, padding: "5px 8px", fontSize: "0.82rem" }}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && productEditName.trim())
                                  renameMutation.mutate({ productId: product.id, name: productEditName, category: productEditCategory });
                                if (e.key === "Escape") setEditingProductId(null);
                              }}
                            />
                            <select
                              value={productEditCategory}
                              onChange={(e) => setProductEditCategory(e.target.value)}
                              style={{ ...inputStyle, width: "auto", padding: "5px 6px", fontSize: "0.78rem" }}
                            >
                              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button
                              onClick={() => renameMutation.mutate({ productId: product.id, name: productEditName, category: productEditCategory })}
                              disabled={renameMutation.isPending || !productEditName.trim()}
                              style={{ ...primaryBtn, padding: "5px 10px", fontSize: "0.78rem" }}
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingProductId(null)} style={{ ...ghostBtn, padding: "5px 8px" }}>
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span style={{ flex: 1, fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</span>
                            {product.category && (
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", background: "var(--bg-secondary)", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>{product.category}</span>
                            )}
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => { setEditingProductId(product.id); setProductEditName(product.name); setProductEditCategory(product.category ?? "Otro"); }}
                                  style={{ ...ghostBtn, padding: "4px 8px" }}
                                  title="Rename product"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete "${product.name}"? Affected items will need to be re-mapped.`))
                                      deleteMutation.mutate(product.id);
                                  }}
                                  disabled={deleteMutation.isPending}
                                  style={{ ...ghostBtn, padding: "4px 8px", color: "var(--color-danger)", borderColor: "rgba(248,113,113,0.3)" }}
                                  title="Delete product"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Confirmed Mappings */}
            {allMappings.length > 0 && (
              <section>
                <SectionHeader
                  icon={<CheckCircle2 size={16} />}
                  title="Confirmed Mappings"
                  subtitle="Raw names permanently linked to canonical products. Future scans skip the review queue for these."
                  color="var(--color-success)"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {allMappings.map((mapping) => {
                    const product = productsById.get(mapping.product_id);
                    const isAdmin = isAdminOf(mapping.group_id);
                    return (
                      <div key={mapping.id} style={{ ...cardStyle, padding: "9px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                        <Tag size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: "0.8rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={mapping.raw_name}>
                          {mapping.raw_name}
                        </span>
                        <ArrowRightLeft size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-success)", flexShrink: 0, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={product?.name}>
                          {product?.name ?? "Unknown"}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              if (confirm(`Remove mapping "${mapping.raw_name}" → "${product?.name}"?\nItems with this raw name will re-appear in the audit queue on next scan.`))
                                deleteMappingMutation.mutate(mapping.id);
                            }}
                            disabled={deleteMappingMutation.isPending}
                            style={{ ...ghostBtn, padding: "3px 7px", color: "var(--color-danger)", borderColor: "rgba(248,113,113,0.3)", flexShrink: 0 }}
                            title="Remove mapping"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {allProducts.length === 0 && allMappings.length === 0 && (
              <div style={{ ...cardStyle, padding: "24px 16px", textAlign: "center" }}>
                <Package size={28} color="var(--text-muted)" style={{ margin: "0 auto 10px" }} />
                <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>No products yet — add your first from the queue.</p>
              </div>
            )}
          </div>

        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) { .audit-layout { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

// ─── item list ─────────────────────────────────────────────────────────────────

function TransactionItemList({ items }: { items: AuditItem[] }) {
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-color)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item) => (
        <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: "0.82rem" }}>
          <span style={{ color: "var(--text-muted)" }}>
            {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>@ {item.unit_price.toFixed(2)}</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 500, minWidth: 56, textAlign: "right" }}>{item.item_total.toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── small helpers ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle, color }: { icon: React.ReactNode; title: string; subtitle: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color, marginTop: 2 }}>
        {icon}
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>{title}</h2>
        <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>{subtitle}</p>
      </div>
    </div>
  );
}

function StatChip({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number | null; color: string }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "7px 13px", fontSize: "0.82rem" }}>
      <span style={{ color }}>{icon}</span>
      {count !== null && <span style={{ fontWeight: 700, color }}>{count}</span>}
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}

// ─── shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "16px 18px" };
const primaryBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 7, padding: "8px 13px", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" };
const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: 7, padding: "7px 12px", fontWeight: 500, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 5, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" };
const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 7, padding: "8px 11px", color: "var(--text-primary)", fontSize: "0.88rem", boxSizing: "border-box" };
