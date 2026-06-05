import { useState, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { runNormalizationPipeline } from "../lib/fuzzyMatch";
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
};

// Cluster groups items that share the same normalised raw name.
type Cluster = {
  key: string;           // lower(trim(name))
  rawName: string;       // display name (from first item)
  groupId: string;
  items: AuditItem[];
  // mutable form state
  canonicalName: string;
  category: string;
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
    .select("id, name, category, created_at")
    .order("name");
  if (error) {
    console.error("[ProductAudit] fetchAllProducts ERROR:", { message: error.message, code: (error as any).code });
    return [];
  }
  return data as Product[];
}

// ─── scan pipeline ────────────────────────────────────────────────────────────

async function runScan(): Promise<{ scanned: number; autoMatched: number; needsReview: number; newCandidates: number }> {
  // 1. Fetch unmapped items (no mapping_status yet, no product_id)
  const { data: rawItems, error: itemsErr } = await supabase
    .from("transaction_items")
    .select("id, name")
    .is("mapping_status", null)
    .is("product_id", null)
    .neq("name", "Unknown");

  if (itemsErr) throw itemsErr;
  if (!rawItems || rawItems.length === 0) return { scanned: 0, autoMatched: 0, needsReview: 0, newCandidates: 0 };

  // 2. Fetch all products (no group_id — shared catalog)
  const { data: products, error: productsErr } = await supabase
    .from("products")
    .select("id, name, category, created_at");
  if (productsErr) {
    console.error("[ProductAudit] runScan step 2 ERROR:", { message: productsErr.message, code: (productsErr as any).code });
    throw productsErr;
  }
  // 3. Run fuzzy matching against the full catalog
  const flatItems = (rawItems as Array<{ id: string; name: string }>).map(
    (r) => ({ id: r.id, name: r.name }),
  );
  const results = runNormalizationPipeline(flatItems, (products ?? []) as Product[]);

  // 5. Group by (status, suggestedProductId) for batch DB updates
  const autoMatchedByProduct = new Map<string, string[]>(); // productId → itemIds
  const reviewByProduct = new Map<string, string[]>();
  const newCandidateIds: string[] = [];

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

  // 6. Batch update
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

  return {
    scanned: results.length,
    autoMatched: [...autoMatchedByProduct.values()].reduce((s, ids) => s + ids.length, 0),
    needsReview: [...reviewByProduct.values()].reduce((s, ids) => s + ids.length, 0),
    newCandidates: newCandidateIds.length,
  };
}

// ─── component ────────────────────────────────────────────────────────────────

export function ProductAudit() {
  const qc = useQueryClient();

  const auditQuery = useQuery({
    queryKey: ["audit-items"],
    queryFn: fetchAuditItems,
    retry: false,
  });

  const productsQuery = useQuery({
    queryKey: ["all-products"],
    queryFn: fetchAllProducts,
    retry: false,
  });

  // Detect missing columns — happens when migration 0008 has not been applied yet.
  const auditError = auditQuery.error as (Error & { code?: string }) | null;
  const isMigrationNeeded =
    auditQuery.isError &&
    (auditError?.code === "42703" ||
      auditError?.message?.toLowerCase().includes("column") ||
      auditError?.message?.toLowerCase().includes("does not exist") ||
      // Supabase also surfaces schema-cache mismatches as generic 400s
      auditQuery.isError);

  // Map for quick product-name lookup
  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of productsQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [productsQuery.data]);

  // ── scan mutation ──────────────────────────────────────────────────────────

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

  // ── confirm match mutation (needs_mapping_review → auto_matched) ───────────

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
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      toast.success(`"${rawName}" confirmed.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── treat-as-new mutation (move needs_mapping_review → new_product_candidate) ─

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

  // ── approve new product mutation ───────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: async ({
      rawName,
      canonicalName,
      category,
      groupId,
    }: {
      rawName: string;
      canonicalName: string;
      category: string;
      groupId: string;
    }) => {
      const { error } = await supabase.rpc("approve_product_mapping", {
        p_raw_name: rawName,
        p_canonical_name: canonicalName.trim(),
        p_category: category,
        p_group_id: groupId,
      });
      if (error) throw error;
    },
    onSuccess: (_, { canonicalName }) => {
      qc.invalidateQueries({ queryKey: ["audit-items"] });
      qc.invalidateQueries({ queryKey: ["all-products"] });
      qc.invalidateQueries({ queryKey: ["pending-audit-count"] });
      toast.success(`"${canonicalName}" added to catalog.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── cluster state for new-candidate form fields ────────────────────────────

  const [clusterEdits, setClusterEdits] = useState<Record<string, { canonicalName: string; category: string }>>({});

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
    },
    [getClusterEdit],
  );

  // ── derive clusters from audit items ──────────────────────────────────────

  const items = auditQuery.data ?? [];

  const potentialClusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const item of items.filter((i) => i.mapping_status === "needs_mapping_review")) {
      const key = item.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          key,
          rawName: item.name,
          groupId: item.transactions.group_id,
          items: [],
          canonicalName: item.name,
          category: item.category ?? "Otro",
        });
      }
      map.get(key)!.items.push(item);
    }
    return [...map.values()];
  }, [items]);

  const newCandidateClusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const item of items.filter((i) => i.mapping_status === "new_product_candidate")) {
      const key = item.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          key,
          rawName: item.name,
          groupId: item.transactions.group_id,
          items: [],
          canonicalName: item.name,
          category: item.category ?? "Otro",
        });
      }
      map.get(key)!.items.push(item);
    }
    return [...map.values()];
  }, [items]);

  const isLoading = (auditQuery.isLoading || productsQuery.isLoading) && !isMigrationNeeded;
  const totalPending = potentialClusters.length + newCandidateClusters.length;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "var(--color-accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontWeight: 600,
            fontSize: "0.85rem",
            cursor: scanMutation.isPending ? "wait" : "pointer",
            flexShrink: 0,
            opacity: scanMutation.isPending ? 0.7 : 1,
          }}
        >
          {scanMutation.isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ScanSearch size={15} />}
          {scanMutation.isPending ? "Scanning…" : "Scan Unmapped Items"}
        </button>
      </div>

      {/* Migration-needed banner */}
      {isMigrationNeeded && (
        <div style={{
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
          background: "rgba(248,113,113,0.07)",
          border: "1px solid rgba(248,113,113,0.3)",
          borderRadius: 10,
          padding: "16px 18px",
          marginBottom: 24,
        }}>
          <AlertTriangle size={18} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--color-danger)", fontSize: "0.9rem" }}>
              Database migration required
            </p>
            <p style={{ margin: "0 0 10px", fontSize: "0.83rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              The <code style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, padding: "1px 5px" }}>mapping_status</code> and{" "}
              <code style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, padding: "1px 5px" }}>suggested_product_id</code>{" "}
              columns are missing. Run migration <strong>0008_product_normalization.sql</strong> in your Supabase SQL editor, then reload this page.
            </p>
            <details style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              <summary style={{ cursor: "pointer", marginBottom: 6 }}>How to apply</summary>
              <ol style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.8 }}>
                <li>Open <strong>Supabase dashboard → SQL Editor</strong></li>
                <li>Paste the contents of <code>supabase/migrations/0008_product_normalization.sql</code></li>
                <li>Click <strong>Run</strong>, then reload this page</li>
              </ol>
            </details>
          </div>
        </div>
      )}

      {/* Summary strip */}
      {!isLoading && !isMigrationNeeded && (
        <div style={{
          display: "flex",
          gap: 12,
          marginBottom: 28,
          flexWrap: "wrap",
        }}>
          <StatChip
            color="var(--color-accent)"
            label="Potential matches"
            count={potentialClusters.length}
            icon={<ArrowRightLeft size={14} />}
          />
          <StatChip
            color="#f59e0b"
            label="New candidates"
            count={newCandidateClusters.length}
            icon={<Plus size={14} />}
          />
          {totalPending === 0 && (
            <StatChip
              color="var(--color-success)"
              label="All clear — nothing pending"
              count={null}
              icon={<CheckCircle2 size={14} />}
            />
          )}
        </div>
      )}

      {isLoading && !isMigrationNeeded && (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ margin: 0, fontSize: "0.85rem" }}>Loading audit data…</p>
        </div>
      )}

      {/* ── Potential Matches ──────────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && potentialClusters.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionHeader
            icon={<ArrowRightLeft size={16} />}
            title="Potential Matches"
            subtitle="Fuzzy score 60–90 % — confirm or reclassify as new."
            color="var(--color-accent)"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {potentialClusters.map((cluster) => {
              const suggestedProduct = cluster.items[0].suggested_product_id
                ? productsById.get(cluster.items[0].suggested_product_id)
                : null;
              const isPending =
                confirmMutation.isPending || treatAsNewMutation.isPending;

              return (
                <div key={cluster.key} style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <Tag size={13} color="var(--text-muted)" />
                        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Raw name · {cluster.items.length} item{cluster.items.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                        {cluster.rawName}
                      </p>
                      {suggestedProduct ? (
                        <div style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 7,
                          background: "rgba(59,130,246,0.10)",
                          border: "1px solid rgba(59,130,246,0.25)",
                          borderRadius: 6,
                          padding: "5px 10px",
                          fontSize: "0.82rem",
                        }}>
                          <Package size={13} color="var(--color-accent)" />
                          <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>{suggestedProduct.name}</span>
                          {suggestedProduct.category && (
                            <span style={{ color: "var(--text-muted)" }}>· {suggestedProduct.category}</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Suggested product not found</span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
                      {suggestedProduct && (
                        <button
                          disabled={isPending}
                          onClick={() =>
                            confirmMutation.mutate({
                              rawName: cluster.rawName,
                              productId: suggestedProduct.id,
                              groupId: cluster.groupId,
                            })
                          }
                          style={primaryBtn}
                        >
                          <CheckCircle2 size={13} />
                          Confirm Match
                        </button>
                      )}
                      <button
                        disabled={isPending}
                        onClick={() =>
                          treatAsNewMutation.mutate({
                            ids: cluster.items.map((i) => i.id),
                            rawName: cluster.rawName,
                          })
                        }
                        style={ghostBtn}
                      >
                        <Plus size={13} />
                        Treat as New
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── New Product Candidates ──────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && newCandidateClusters.length > 0 && (
        <section>
          <SectionHeader
            icon={<Plus size={16} />}
            title="New Product Candidates"
            subtitle="No match found — edit the canonical name and add to your catalog."
            color="#f59e0b"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {newCandidateClusters.map((cluster) => {
              const edit = getClusterEdit(cluster.key, cluster.rawName, cluster.category ?? "Otro");
              const isPending = approveMutation.isPending;

              return (
                <div key={cluster.key} style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Tag size={13} color="var(--text-muted)" />
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Raw name · {cluster.items.length} item{cluster.items.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 14px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                    {cluster.rawName}
                  </p>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ flex: "2 1 180px" }}>
                      <label style={labelStyle}>Canonical name</label>
                      <input
                        value={edit.canonicalName}
                        onChange={(e) =>
                          setClusterField(cluster.key, "canonicalName", e.target.value, cluster.rawName, cluster.category ?? "Otro")
                        }
                        style={inputStyle}
                        placeholder="Enter canonical product name"
                      />
                    </div>
                    <div style={{ flex: "1 1 140px" }}>
                      <label style={labelStyle}>Category</label>
                      <select
                        value={edit.category}
                        onChange={(e) =>
                          setClusterField(cluster.key, "category", e.target.value, cluster.rawName, cluster.category ?? "Otro")
                        }
                        style={inputStyle}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      disabled={isPending || !edit.canonicalName.trim()}
                      onClick={() =>
                        approveMutation.mutate({
                          rawName: cluster.rawName,
                          canonicalName: edit.canonicalName,
                          category: edit.category,
                          groupId: cluster.groupId,
                        })
                      }
                      style={{
                        ...primaryBtn,
                        background: "#f59e0b",
                        alignSelf: "flex-end",
                        opacity: isPending || !edit.canonicalName.trim() ? 0.5 : 1,
                      }}
                    >
                      <Plus size={13} />
                      Add to Catalog
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!isLoading && !isMigrationNeeded && totalPending === 0 && !scanMutation.isPending && (
        <div style={{
          textAlign: "center",
          padding: "56px 24px",
          background: "var(--bg-card)",
          borderRadius: 12,
          border: "1px solid var(--border-color)",
        }}>
          <CheckCircle2 size={40} color="var(--color-success)" style={{ margin: "0 auto 14px" }} />
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>
            All items are mapped
          </p>
          <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
            Click <strong>Scan Unmapped Items</strong> to check for new receipts that need normalization.
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── small helpers ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        background: `${color}22`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
        marginTop: 2,
      }}>
        {icon}
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>{title}</h2>
        <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>{subtitle}</p>
      </div>
    </div>
  );
}

function StatChip({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number | null;
  color: string;
}) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      background: "var(--bg-card)",
      border: "1px solid var(--border-color)",
      borderRadius: 8,
      padding: "7px 13px",
      fontSize: "0.82rem",
    }}>
      <span style={{ color }}>{icon}</span>
      {count !== null && (
        <span style={{ fontWeight: 700, color }}>{count}</span>
      )}
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}

// ─── shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 10,
  padding: "16px 18px",
};

const primaryBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "var(--color-accent)",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  padding: "8px 13px",
  fontWeight: 600,
  fontSize: "0.82rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  color: "var(--text-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: 7,
  padding: "7px 12px",
  fontWeight: 500,
  fontSize: "0.82rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  marginBottom: 5,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: 7,
  padding: "8px 11px",
  color: "var(--text-primary)",
  fontSize: "0.88rem",
};
