import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  getProductAuditItems,
  getProducts,
  getProductMappings,
  runProductScan,
  confirmProductMatch,
  approveProductMapping,
  renameProduct,
  deleteProduct,
  deleteProductMapping,
  resetTransactionItemsToNewCandidate,
} from "../api/products";
import { getGroupRoles } from "../api/groups";
import { runNormalizationPipeline } from "../lib/fuzzyMatch";
import { ConfirmModal } from "../components/ConfirmModal";
import type { MappingStatus, Product } from "../types";

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

const CATEGORY_I18N: Record<string, string> = {
  "Comida": "categories.comida",
  "Limpieza": "categories.limpieza",
  "Salud": "categories.salud",
  "Entretenimiento": "categories.entretenimiento",
  "Hogar": "categories.hogar",
  "Transporte": "categories.transporte",
  "Vestimenta": "categories.vestimenta",
  "Restaurante": "categories.restaurante",
  "Cuidado Personal": "categories.cuidadoPersonal",
  "Mascotas": "categories.mascotas",
  "Servicios": "categories.servicios",
  "Educación": "categories.educacion",
  "Tecnología": "categories.tecnologia",
  "Otro": "categories.otro",
};

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

// ─── combobox component ────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return products;
    const q = normalize(value);
    const matches = products.filter((p) => {
      const name = normalize(p.name);
      if (name.includes(q) || q.includes(name)) return true;
      return name.split(/[\s\W]+/).filter((w) => w.length >= 3).some((token) => q.includes(token));
    });
    return matches.length > 0 ? matches : products;
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
      <label style={labelStyle}>{t("audit.canonical")}</label>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={inputStyle}
        placeholder={placeholder ?? t("audit.typeOrSelectProduct")}
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
          maxHeight: 240,
          overflowY: "auto",
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

const CLUSTERS_PER_PAGE = 10;

// ─── component ────────────────────────────────────────────────────────────────

export function ProductAudit() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  const auditQuery = useQuery({ queryKey: ["audit-items"], queryFn: getProductAuditItems, retry: false });
  const productsQuery = useQuery({ queryKey: ["all-products"], queryFn: getProducts, retry: false });
  const rawMappingsQuery = useQuery({ queryKey: ["product-raw-mappings"], queryFn: getProductMappings, retry: false });
  const rolesQuery = useQuery({ queryKey: ["my-group-roles"], queryFn: getGroupRoles });

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
    mutationFn: runProductScan,
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
    mutationFn: ({ rawName, productId, groupId }: { rawName: string; productId: string; groupId: string }) =>
      confirmProductMatch({ rawName, productId, groupId }),
    onSuccess: (_, { rawName }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      setPotentialPage(0); setNewPage(0);
      toast.success(`"${rawName}" confirmed.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── treat as new ─────────────────────────────────────────────────────────

  const treatAsNewMutation = useMutation({
    mutationFn: ({ ids }: { ids: string[]; rawName: string }) =>
      resetTransactionItemsToNewCandidate(ids),
    onSuccess: (_, { rawName }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      setPotentialPage(0); setNewPage(0);
      toast.info(`"${rawName}" moved to New Candidates.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── approve / map to existing product ────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: ({ rawName, canonicalName, category, groupId, existingProductId }: {
      rawName: string;
      canonicalName: string;
      category: string;
      groupId: string;
      existingProductId: string | null;
    }) =>
      existingProductId
        ? confirmProductMatch({ rawName, productId: existingProductId, groupId })
        : approveProductMapping({ rawName, canonicalName, category, groupId }),
    onSuccess: (_, { canonicalName, existingProductId }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["all-products"] });
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      setPotentialPage(0); setNewPage(0);
      toast.success(existingProductId ? `Mapped to "${canonicalName}".` : `"${canonicalName}" added to catalog.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── product catalog: rename ───────────────────────────────────────────────

  const renameMutation = useMutation({
    mutationFn: ({ productId, name, category }: { productId: string; name: string; category: string }) =>
      renameProduct(productId, name, category),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-products"] });
      setEditingProductId(null);
      toast.success("Product updated.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── product catalog: delete ───────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (productId: string) => deleteProduct(productId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-products"] });
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      setPotentialPage(0); setNewPage(0);
      toast.success("Product deleted. Affected items will re-appear on next scan.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── delete raw mapping ────────────────────────────────────────────────────

  const deleteMappingMutation = useMutation({
    mutationFn: (mappingId: string) => deleteProductMapping(mappingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-raw-mappings"] });
      toast.success("Mapping removed. Items with this raw name will re-appear in the audit queue on next scan.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── search + pagination ───────────────────────────────────────────────────

  const [auditSearch, setAuditSearch] = useState("");
  const [potentialPage, setPotentialPage] = useState(0);
  const [newPage, setNewPage] = useState(0);

  useEffect(() => {
    setPotentialPage(0);
    setNewPage(0);
  }, [auditSearch]);

  // ── cluster state ─────────────────────────────────────────────────────────

  const [clusterEdits, setClusterEdits] = useState<Record<string, { canonicalName: string; category: string }>>({});
  const [clusterSelectedProduct, setClusterSelectedProduct] = useState<Record<string, Product | null>>({});
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [overridingClusters, setOverridingClusters] = useState<Set<string>>(new Set());
  const [overrideEdits, setOverrideEdits] = useState<Record<string, string>>({});
  const [overrideSelectedProduct, setOverrideSelectedProduct] = useState<Record<string, Product | null>>({});

  // catalog edit state
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productEditName, setProductEditName] = useState("");
  const [productEditCategory, setProductEditCategory] = useState("");

  const [pendingConfirm, setPendingConfirm] = useState<{ body: string; onConfirm: () => void } | null>(null);

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

  const mappingsByProductId = useMemo(() => {
    const map = new Map<string, typeof allMappings>();
    for (const m of allMappings) {
      const list = map.get(m.product_id) ?? [];
      list.push(m);
      map.set(m.product_id, list);
    }
    return map;
  }, [allMappings]);

  const visiblePotential = useMemo(() =>
    auditSearch.trim()
      ? potentialClusters.filter((c) => c.rawName.toLowerCase().includes(auditSearch.toLowerCase()))
      : potentialClusters,
  [potentialClusters, auditSearch]);

  const visibleNew = useMemo(() =>
    auditSearch.trim()
      ? newCandidateClusters.filter((c) => c.rawName.toLowerCase().includes(auditSearch.toLowerCase()))
      : newCandidateClusters,
  [newCandidateClusters, auditSearch]);

  const pagedPotential = visiblePotential.slice(potentialPage * CLUSTERS_PER_PAGE, (potentialPage + 1) * CLUSTERS_PER_PAGE);
  const totalPotentialPages = Math.ceil(visiblePotential.length / CLUSTERS_PER_PAGE);
  const pagedNew = visibleNew.slice(newPage * CLUSTERS_PER_PAGE, (newPage + 1) * CLUSTERS_PER_PAGE);
  const totalNewPages = Math.ceil(visibleNew.length / CLUSTERS_PER_PAGE);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {t("audit.productAuditTitle")}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            {t("audit.productAuditDesc")}
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending || isMigrationNeeded}
          style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, fontSize: "0.85rem", cursor: scanMutation.isPending ? "wait" : "pointer", flexShrink: 0, opacity: scanMutation.isPending ? 0.7 : 1 }}
        >
          {scanMutation.isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ScanSearch size={15} />}
          {scanMutation.isPending ? t("audit.scanning") : t("audit.scanBtn")}
        </button>
      </div>

      {/* Migration banner */}
      {isMigrationNeeded && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "16px 18px", marginBottom: 24 }}>
          <AlertTriangle size={18} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--color-danger)", fontSize: "0.9rem" }}>{t("audit.migrationTitle")}</p>
            <p style={{ margin: "0 0 10px", fontSize: "0.83rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Run migration <strong>0008_product_normalization.sql</strong> then <strong>0021_product_admin_controls.sql</strong> in your Supabase SQL editor, then reload.
            </p>
          </div>
        </div>
      )}

      {/* Stat chips */}
      {!isLoading && !isMigrationNeeded && (
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          <StatChip color="var(--color-accent)" label={t("audit.potentialMatchesChip")} count={potentialClusters.length} icon={<ArrowRightLeft size={14} />} />
          <StatChip color="#f59e0b" label={t("audit.newCandidatesChip")} count={newCandidateClusters.length} icon={<Plus size={14} />} />
          {totalPending === 0 && <StatChip color="var(--color-success)" label={t("audit.allClearChip")} count={null} icon={<CheckCircle2 size={14} />} />}
        </div>
      )}

      {isLoading && !isMigrationNeeded && (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ margin: 0, fontSize: "0.85rem" }}>{t("audit.loadingAudit")}</p>
        </div>
      )}

      {/* ── Two-panel grid ──────────────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && (
        <div className="audit-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 28, alignItems: "start" }}>

          {/* ── LEFT: audit queue ──────────────────────────────────────── */}
          <div>
            {/* Search */}
            {totalPending > 0 && (
              <div style={{ position: "relative", marginBottom: 20 }}>
                <Search size={14} color="var(--text-muted)" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder={t("audit.filterRaw")}
                  style={{ ...inputStyle, paddingLeft: 32 }}
                />
              </div>
            )}

            {/* Potential Matches */}
            {visiblePotential.length > 0 && (
              <section style={{ marginBottom: 36 }}>
                <SectionHeader icon={<ArrowRightLeft size={16} />} title={t("audit.potentialMatchesSection")} subtitle={t("audit.potentialMatchesDesc")} color="var(--color-accent)" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {pagedPotential.map((cluster) => {
                    const suggestedProduct = cluster.items[0].suggested_product_id
                      ? productsById.get(cluster.items[0].suggested_product_id)
                      : null;
                    const isPending = confirmMutation.isPending || treatAsNewMutation.isPending;
                    const isExpanded = expandedClusters.has(cluster.key);
                    const isAdmin = isAdminOf(cluster.groupId);
                    const isOverriding = overridingClusters.has(cluster.key);
                    const overrideEdit = overrideEdits[cluster.key] ?? "";
                    const overrideProduct = overrideSelectedProduct[cluster.key] ?? null;
                    return (
                      <div key={cluster.key} style={cardStyle}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <button onClick={() => toggleExpanded(cluster.key)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                              {isExpanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                              <Tag size={13} color="var(--text-muted)" />
                              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                {t("audit.rawNameCount", { count: cluster.items.length })}
                              </span>
                            </button>
                            <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                              {cluster.rawName}
                            </p>
                            {!isOverriding && (suggestedProduct ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 6, padding: "5px 10px", fontSize: "0.82rem" }}>
                                  <Package size={13} color="var(--color-accent)" />
                                  <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>{suggestedProduct.name}</span>
                                  {suggestedProduct.category && <span style={{ color: "var(--text-muted)" }}>· {suggestedProduct.category}</span>}
                                  {cluster.similarity !== undefined && (
                                    <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>· {Math.round(cluster.similarity * 100)}%</span>
                                  )}
                                </div>
                                {isAdmin && (
                                  <button
                                    onClick={() => {
                                      setOverridingClusters((prev) => { const s = new Set(prev); s.add(cluster.key); return s; });
                                      setOverrideEdits((prev) => ({ ...prev, [cluster.key]: "" }));
                                      setOverrideSelectedProduct((prev) => ({ ...prev, [cluster.key]: null }));
                                    }}
                                    style={{ background: "none", border: "none", padding: 0, fontSize: "0.75rem", color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" }}
                                  >
                                    {t("audit.wrongMatch")}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{t("audit.suggestedNotFound")}</span>
                            ))}
                            {isOverriding && isAdmin && (
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 4 }}>
                                <ProductCombobox
                                  value={overrideEdit}
                                  onChange={(v) => {
                                    setOverrideEdits((prev) => ({ ...prev, [cluster.key]: v }));
                                    setOverrideSelectedProduct((prev) => ({ ...prev, [cluster.key]: null }));
                                  }}
                                  onSelect={(p) => {
                                    setOverrideEdits((prev) => ({ ...prev, [cluster.key]: p.name }));
                                    setOverrideSelectedProduct((prev) => ({ ...prev, [cluster.key]: p }));
                                  }}
                                  products={(productsQuery.data ?? []).filter((p) => p.group_id === cluster.groupId)}
                                  placeholder={t("audit.selectCorrectProduct")}
                                />
                                <div style={{ display: "flex", gap: 7, alignSelf: "flex-end" }}>
                                  <button
                                    disabled={isPending || !overrideEdit.trim()}
                                    onClick={() => {
                                      approveMutation.mutate({
                                        rawName: cluster.rawName,
                                        canonicalName: overrideEdit,
                                        category: overrideProduct?.category ?? cluster.category ?? "Otro",
                                        groupId: cluster.groupId,
                                        existingProductId: overrideProduct?.id ?? null,
                                      });
                                      setOverridingClusters((prev) => { const s = new Set(prev); s.delete(cluster.key); return s; });
                                    }}
                                    style={{ ...primaryBtn, background: overrideProduct ? "var(--color-accent)" : "#f59e0b", opacity: !overrideEdit.trim() || isPending ? 0.5 : 1 }}
                                  >
                                    {overrideProduct ? <><ArrowRightLeft size={13} /> {t("audit.mapTo", { name: overrideProduct.name })}</> : <><Plus size={13} /> {t("audit.addToCatalog")}</>}
                                  </button>
                                  <button
                                    onClick={() => setOverridingClusters((prev) => { const s = new Set(prev); s.delete(cluster.key); return s; })}
                                    style={ghostBtn}
                                  >
                                    <X size={13} /> {t("common.cancel")}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          {isAdmin && !isOverriding ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
                              {suggestedProduct && (
                                <button disabled={isPending} onClick={() => confirmMutation.mutate({ rawName: cluster.rawName, productId: suggestedProduct.id, groupId: cluster.groupId })} style={primaryBtn}>
                                  <CheckCircle2 size={13} /> {t("audit.confirmMatch")}
                                </button>
                              )}
                              <button disabled={isPending} onClick={() => treatAsNewMutation.mutate({ ids: cluster.items.map((i) => i.id), rawName: cluster.rawName })} style={ghostBtn}>
                                <Plus size={13} /> {t("audit.treatAsNew")}
                              </button>
                            </div>
                          ) : (!isAdmin && (
                            <p style={{ margin: 0, fontSize: "0.79rem", color: "var(--text-muted)" }}>{t("audit.onlyAdminsConfirm")}</p>
                          ))}
                        </div>
                        {isExpanded && <TransactionItemList items={cluster.items} />}
                      </div>
                    );
                  })}
                </div>
                {totalPotentialPages > 1 && (
                  <div className="tx-pagination">
                    <button type="button" style={ghostBtn} disabled={potentialPage === 0} onClick={() => setPotentialPage((p) => p - 1)}>
                      {t("common.prevPage")}
                    </button>
                    <span className="tx-pagination__info">
                      {t("common.pageInfo", { current: potentialPage + 1, total: totalPotentialPages })}
                    </span>
                    <button type="button" style={ghostBtn} disabled={potentialPage >= totalPotentialPages - 1} onClick={() => setPotentialPage((p) => p + 1)}>
                      {t("common.nextPage")}
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* New Product Candidates */}
            {visibleNew.length > 0 && (
              <section style={{ marginBottom: 36 }}>
                <SectionHeader icon={<Plus size={16} />} title={t("audit.newCandidatesSection")} subtitle={t("audit.newCandidatesDesc")} color="#f59e0b" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {pagedNew.map((cluster) => {
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
                            {t("audit.rawNameCount", { count: cluster.items.length })}
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
                              <label style={labelStyle}>{t("audit.categoryLabel")}</label>
                              <select
                                value={edit.category}
                                onChange={(e) => setClusterField(cluster.key, "category", e.target.value, cluster.rawName, cluster.category ?? "Otro")}
                                style={inputStyle}
                              >
                                {CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_I18N[c] ?? c)}</option>)}
                              </select>
                            </div>
                            <button
                              disabled={isPending || !edit.canonicalName.trim()}
                              onClick={() => approveMutation.mutate({ rawName: cluster.rawName, canonicalName: edit.canonicalName, category: edit.category, groupId: cluster.groupId, existingProductId: selectedProduct?.id ?? null })}
                              style={{ ...primaryBtn, background: selectedProduct ? "var(--color-accent)" : "#f59e0b", alignSelf: "flex-end", opacity: isPending || !edit.canonicalName.trim() ? 0.5 : 1 }}
                            >
                              {selectedProduct
                                ? <><ArrowRightLeft size={13} /> {t("audit.mapTo", { name: selectedProduct.name })}</>
                                : <><Plus size={13} /> {t("audit.addToCatalog")}</>
                              }
                            </button>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>{t("audit.onlyAdminsAdd")}</p>
                        )}
                        {isExpanded && <TransactionItemList items={cluster.items} />}
                      </div>
                    );
                  })}
                </div>
                {totalNewPages > 1 && (
                  <div className="tx-pagination">
                    <button type="button" style={ghostBtn} disabled={newPage === 0} onClick={() => setNewPage((p) => p - 1)}>
                      {t("common.prevPage")}
                    </button>
                    <span className="tx-pagination__info">
                      {t("common.pageInfo", { current: newPage + 1, total: totalNewPages })}
                    </span>
                    <button type="button" style={ghostBtn} disabled={newPage >= totalNewPages - 1} onClick={() => setNewPage((p) => p + 1)}>
                      {t("common.nextPage")}
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* No search results */}
            {auditSearch.trim() && visiblePotential.length === 0 && visibleNew.length === 0 && totalPending > 0 && (
              <div style={{ textAlign: "center", padding: "32px 24px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                {t("audit.noSearchResults", { query: auditSearch })}
              </div>
            )}

            {/* Empty state */}
            {totalPending === 0 && !scanMutation.isPending && (
              <div style={{ textAlign: "center", padding: "56px 24px", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
                <CheckCircle2 size={40} color="var(--color-success)" style={{ margin: "0 auto 14px" }} />
                <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>{t("audit.allMapped")}</p>
                <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
                  {t("audit.allMappedDesc")}
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
                  title={t("audit.productCatalogSection")}
                  subtitle={t("audit.productCatalogCount", { count: allProducts.length })}
                  color="var(--text-muted)"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {allProducts.map((product) => {
                    const isEditing = editingProductId === product.id;
                    const isAdmin = isAdminOf(product.group_id ?? "");
                    const productMappings = mappingsByProductId.get(product.id) ?? [];
                    return (
                      <div key={product.id} style={{ ...cardStyle, padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                                {CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_I18N[c] ?? c)}</option>)}
                              </select>
                              <button
                                onClick={() => renameMutation.mutate({ productId: product.id, name: productEditName, category: productEditCategory })}
                                disabled={renameMutation.isPending || !productEditName.trim()}
                                style={{ ...primaryBtn, padding: "5px 10px", fontSize: "0.78rem" }}
                              >
                                {t("common.save")}
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
                                    onClick={() => setPendingConfirm({
                                      body: t("audit.deleteProductConfirm", { name: product.name }),
                                      onConfirm: () => deleteMutation.mutate(product.id),
                                    })}
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
                        {!isEditing && productMappings.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7, paddingLeft: 21 }}>
                            {productMappings.map((m) => (
                              <span key={m.id} style={{ fontSize: "0.68rem", color: "var(--text-muted)", background: "var(--bg-secondary)", borderRadius: 4, padding: "2px 6px", border: "1px solid var(--border-color)" }}>
                                {m.raw_name}
                              </span>
                            ))}
                          </div>
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
                  title={t("audit.confirmedMappingsSection")}
                  subtitle={t("audit.confirmedMappingsDesc")}
                  color="var(--color-success)"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {allMappings.map((mapping) => {
                    const product = productsById.get(mapping.product_id);
                    const isAdmin = isAdminOf(mapping.group_id);
                    return (
                      <div key={mapping.id} style={{ ...cardStyle, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                        <Tag size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: "0.83rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={mapping.raw_name}>
                          {mapping.raw_name}
                        </span>
                        <ArrowRightLeft size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: "0.83rem", fontWeight: 600, color: "var(--color-success)", flexShrink: 0 }}>
                          {product?.name ?? t("audit.unknownProduct")}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => setPendingConfirm({
                              body: t("audit.removeMappingConfirm", { raw: mapping.raw_name, product: product?.name ?? "" }),
                              onConfirm: () => deleteMappingMutation.mutate(mapping.id),
                            })}
                            disabled={deleteMappingMutation.isPending}
                            style={{ ...ghostBtn, padding: "4px 8px", color: "var(--color-danger)", borderColor: "rgba(248,113,113,0.3)", flexShrink: 0 }}
                            title="Remove mapping"
                          >
                            <X size={13} />
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
                <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>{t("audit.noProductsYet")}</p>
              </div>
            )}
          </div>

        </div>
      )}

      <ConfirmModal
        open={pendingConfirm !== null}
        title={t("common.delete")}
        confirmLabel={t("common.delete")}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null); }}
        onCancel={() => setPendingConfirm(null)}
      >
        {pendingConfirm?.body}
      </ConfirmModal>

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

export default ProductAudit;
