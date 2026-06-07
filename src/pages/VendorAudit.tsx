import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScanSearch,
  CheckCircle2,
  Plus,
  ArrowRightLeft,
  Loader2,
  Store,
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
import { runVendorNormalizationPipeline } from "../lib/fuzzyMatchVendor";
import type { Vendor, VendorMappingStatus } from "../types";

// ─── types ────────────────────────────────────────────────────────────────────

type AuditTransaction = {
  id: string;
  vendor_or_source: string | null;
  vendor_mapping_status: VendorMappingStatus;
  suggested_vendor_id: string | null;
  group_id: string;
  date: string | null;
  total_amount: number | null;
  currency: string;
};

type Cluster = {
  key: string;
  rawName: string;
  groupId: string;
  transactions: AuditTransaction[];
  suggestedVendorId: string | null;
  canonicalName: string;
};

// ─── data fetchers ────────────────────────────────────────────────────────────

async function fetchAuditTransactions(): Promise<AuditTransaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, vendor_or_source, vendor_mapping_status, group_id, date, total_amount, currency")
    .in("vendor_mapping_status", ["needs_vendor_review", "new_vendor_candidate"])
    .not("vendor_or_source", "is", null)
    .order("vendor_or_source");
  if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
  return (data ?? []).map((row: any) => ({ ...row, suggested_vendor_id: null }));
}

async function fetchAllVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, group_id, canonical_name, created_at")
    .order("canonical_name");
  if (error) return [];
  return data as Vendor[];
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
  const { data: rawTxs, error: txErr } = await supabase
    .from("transactions")
    .select("id, vendor_or_source, group_id")
    .is("vendor_mapping_status", null)
    .not("vendor_or_source", "is", null)
    .neq("vendor_or_source", "Unknown");

  if (txErr) throw txErr;
  if (!rawTxs || rawTxs.length === 0) return { scanned: 0, autoMatched: 0, needsReview: 0, newCandidates: 0 };

  const { data: vendors, error: vendorsErr } = await supabase
    .from("vendors")
    .select("id, group_id, canonical_name, created_at");
  if (vendorsErr) throw vendorsErr;

  const allVendors = (vendors ?? []) as Vendor[];

  // Run normalization per group so vendors are scoped correctly
  const groupIds = [...new Set(rawTxs.map((t: any) => t.group_id))];
  const results = groupIds.flatMap((gid) => {
    const groupTxs = rawTxs.filter((t: any) => t.group_id === gid);
    const groupVendors = allVendors.filter((v) => v.group_id === gid);
    return runVendorNormalizationPipeline(groupTxs, groupVendors);
  });

  const autoMatchedByVendor = new Map<string, string[]>();
  const reviewByVendor = new Map<string, string[]>();
  const newCandidateIds: string[] = [];

  for (const r of results) {
    if (r.status === "auto_matched" && r.suggestedVendorId) {
      const ids = autoMatchedByVendor.get(r.suggestedVendorId) ?? [];
      ids.push(r.id);
      autoMatchedByVendor.set(r.suggestedVendorId, ids);
    } else if (r.status === "needs_vendor_review") {
      const ids = reviewByVendor.get(r.suggestedVendorId ?? "__none__") ?? [];
      ids.push(r.id);
      reviewByVendor.set(r.suggestedVendorId ?? "__none__", ids);
    } else {
      newCandidateIds.push(r.id);
    }
  }

  const updates: PromiseLike<unknown>[] = [];

  for (const [vendorId, ids] of autoMatchedByVendor) {
    updates.push(
      supabase
        .from("transactions")
        .update({ vendor_id: vendorId, vendor_mapping_status: "auto_matched" })
        .in("id", ids),
    );
  }
  for (const ids of reviewByVendor.values()) {
    updates.push(
      supabase
        .from("transactions")
        .update({ vendor_mapping_status: "needs_vendor_review" })
        .in("id", ids),
    );
  }
  if (newCandidateIds.length > 0) {
    updates.push(
      supabase
        .from("transactions")
        .update({ vendor_mapping_status: "new_vendor_candidate" })
        .in("id", newCandidateIds),
    );
  }

  await Promise.all(updates);

  return {
    scanned: results.length,
    autoMatched: [...autoMatchedByVendor.values()].reduce((s, ids) => s + ids.length, 0),
    needsReview: [...reviewByVendor.values()].reduce((s, ids) => s + ids.length, 0),
    newCandidates: newCandidateIds.length,
  };
}

// ─── combobox component ────────────────────────────────────────────────────────

function VendorCombobox({
  value,
  onChange,
  onSelect,
  vendors,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (vendor: Vendor) => void;
  vendors: Vendor[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return vendors.slice(0, 8);
    const q = value.toLowerCase();
    return vendors.filter((v) => v.canonical_name.toLowerCase().includes(q)).slice(0, 8);
  }, [value, vendors]);

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
        placeholder={placeholder ?? "Type or select existing vendor…"}
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
          {filtered.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(v);
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
              <Store size={13} color="var(--text-muted)" />
              {v.canonical_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export function VendorAudit() {
  const qc = useQueryClient();

  const auditQuery = useQuery({ queryKey: ["vendor-audit-txs"], queryFn: fetchAuditTransactions, retry: false });
  const vendorsQuery = useQuery({ queryKey: ["all-vendors"], queryFn: fetchAllVendors, retry: false });
  const rolesQuery = useQuery({ queryKey: ["my-group-roles"], queryFn: fetchMyGroupRoles });

  const auditError = auditQuery.error as (Error & { code?: string }) | null;
  const isMigrationNeeded =
    auditQuery.isError &&
    (auditError?.code === "42703" || auditError?.message?.toLowerCase().includes("column") || auditError?.message?.toLowerCase().includes("does not exist") || auditQuery.isError);

  const vendorsById = useMemo(() => {
    const map = new Map<string, Vendor>();
    for (const v of vendorsQuery.data ?? []) map.set(v.id, v);
    return map;
  }, [vendorsQuery.data]);

  const isAdminOf = useCallback(
    (groupId: string) => rolesQuery.data?.[groupId] === "admin",
    [rolesQuery.data],
  );

  // ── enrich audit txs with client-side suggested vendor IDs ───────────────

  const enrichedTxs = useMemo<AuditTransaction[]>(() => {
    const txs = auditQuery.data ?? [];
    const vendors = vendorsQuery.data ?? [];
    if (!vendors.length || !txs.length) return txs;

    // Group by group_id so normalization is scoped correctly
    const groupIds = [...new Set(txs.map((t) => t.group_id))];
    const suggestionMap = new Map<string, string | null>();

    for (const gid of groupIds) {
      const groupTxs = txs.filter((t) => t.group_id === gid);
      const groupVendors = vendors.filter((v) => v.group_id === gid);
      const results = runVendorNormalizationPipeline(groupTxs, groupVendors);
      for (const r of results) suggestionMap.set(r.id, r.suggestedVendorId);
    }

    return txs.map((tx) => ({ ...tx, suggested_vendor_id: suggestionMap.get(tx.id) ?? null }));
  }, [auditQuery.data, vendorsQuery.data]);

  // ── scan ──────────────────────────────────────────────────────────────────

  const scanMutation = useMutation({
    mutationFn: runScan,
    onSuccess: (stats) => {
      qc.invalidateQueries({ queryKey: ["vendor-audit-txs"] });
      qc.invalidateQueries({ queryKey: ["all-vendors"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      if (stats.scanned === 0) toast.info("No unprocessed vendors found.");
      else toast.success(`Scanned ${stats.scanned} — ${stats.autoMatched} auto-matched, ${stats.needsReview} need review, ${stats.newCandidates} new.`);
    },
    onError: (err: Error) => toast.error(`Scan failed: ${err.message}`),
  });

  // ── confirm potential match ───────────────────────────────────────────────

  const confirmMutation = useMutation({
    mutationFn: async ({ rawName, vendorId, groupId }: { rawName: string; vendorId: string; groupId: string }) => {
      const { error } = await supabase.rpc("confirm_vendor_match", {
        p_raw_name: rawName,
        p_vendor_id: vendorId,
        p_group_id: groupId,
      });
      if (error) throw error;
    },
    onSuccess: (_, { rawName }) => {
      qc.invalidateQueries({ queryKey: ["vendor-audit-txs"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      toast.success(`"${rawName}" confirmed.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const treatAsNewMutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[]; rawName: string }) => {
      const { error } = await supabase
        .from("transactions")
        .update({ vendor_mapping_status: "new_vendor_candidate" })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, { rawName }) => {
      qc.invalidateQueries({ queryKey: ["vendor-audit-txs"] });
      toast.info(`"${rawName}" moved to New Vendors.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── approve / map new vendor ─────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: async ({ rawName, canonicalName, groupId, existingVendorId }: {
      rawName: string;
      canonicalName: string;
      groupId: string;
      existingVendorId: string | null;
    }) => {
      if (existingVendorId) {
        const { error } = await supabase.rpc("confirm_vendor_match", {
          p_raw_name: rawName,
          p_vendor_id: existingVendorId,
          p_group_id: groupId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("approve_vendor_mapping", {
          p_raw_name: rawName,
          p_canonical_name: canonicalName.trim(),
          p_group_id: groupId,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, { canonicalName, existingVendorId }) => {
      qc.invalidateQueries({ queryKey: ["vendor-audit-txs"] });
      qc.invalidateQueries({ queryKey: ["all-vendors"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      toast.success(existingVendorId ? `Mapped to "${canonicalName}".` : `"${canonicalName}" added to vendor catalog.`);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── vendor catalog: rename ─────────────────────────────────────────────────

  const renameMutation = useMutation({
    mutationFn: async ({ vendorId, name }: { vendorId: string; name: string }) => {
      const { error } = await supabase.rpc("rename_vendor", {
        p_vendor_id: vendorId,
        p_canonical_name: name.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-vendors"] });
      setEditingVendorId(null);
      toast.success("Vendor renamed.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── vendor catalog: delete ────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: async (vendorId: string) => {
      const { error } = await supabase.rpc("delete_vendor", { p_vendor_id: vendorId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-vendors"] });
      qc.invalidateQueries({ queryKey: ["vendor-audit-txs"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      toast.success("Vendor deleted. Affected transactions will re-appear on next scan.");
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── cluster state ─────────────────────────────────────────────────────────

  const [clusterEdits, setClusterEdits] = useState<Record<string, string>>({});
  const [clusterSelectedVendor, setClusterSelectedVendor] = useState<Record<string, Vendor | null>>({});
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  // vendor catalog edit state
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorEditName, setVendorEditName] = useState("");

  const getEdit = useCallback(
    (key: string, defaultName: string) => clusterEdits[key] ?? defaultName,
    [clusterEdits],
  );
  const setEdit = useCallback((key: string, value: string) => {
    setClusterEdits((prev) => ({ ...prev, [key]: value }));
    setClusterSelectedVendor((prev) => ({ ...prev, [key]: null }));
  }, []);
  const selectVendor = useCallback((key: string, vendor: Vendor) => {
    setClusterEdits((prev) => ({ ...prev, [key]: vendor.canonical_name }));
    setClusterSelectedVendor((prev) => ({ ...prev, [key]: vendor }));
  }, []);
  const toggleExpanded = useCallback((key: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── derive clusters ───────────────────────────────────────────────────────

  const potentialClusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const tx of enrichedTxs.filter((t) => t.vendor_mapping_status === "needs_vendor_review")) {
      const key = (tx.vendor_or_source ?? "").toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { key, rawName: tx.vendor_or_source ?? "", groupId: tx.group_id, transactions: [], suggestedVendorId: tx.suggested_vendor_id, canonicalName: tx.vendor_or_source ?? "" });
      }
      map.get(key)!.transactions.push(tx);
    }
    return [...map.values()];
  }, [enrichedTxs]);

  const newCandidateClusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const tx of enrichedTxs.filter((t) => t.vendor_mapping_status === "new_vendor_candidate")) {
      const key = (tx.vendor_or_source ?? "").toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { key, rawName: tx.vendor_or_source ?? "", groupId: tx.group_id, transactions: [], suggestedVendorId: null, canonicalName: tx.vendor_or_source ?? "" });
      }
      map.get(key)!.transactions.push(tx);
    }
    return [...map.values()];
  }, [enrichedTxs]);

  const isLoading = (auditQuery.isLoading || vendorsQuery.isLoading) && !isMigrationNeeded;
  const totalPending = potentialClusters.length + newCandidateClusters.length;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Vendor Audit
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Map raw receipt vendor names to your canonical vendor catalog for accurate Pareto analysis.
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending || isMigrationNeeded}
          style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, fontSize: "0.85rem", cursor: scanMutation.isPending ? "wait" : "pointer", flexShrink: 0, opacity: scanMutation.isPending ? 0.7 : 1 }}
        >
          {scanMutation.isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ScanSearch size={15} />}
          {scanMutation.isPending ? "Scanning…" : "Scan Unmapped Vendors"}
        </button>
      </div>

      {isMigrationNeeded && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "16px 18px", marginBottom: 24 }}>
          <AlertTriangle size={18} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--color-danger)", fontSize: "0.9rem" }}>Database migration required</p>
            <p style={{ margin: "0 0 10px", fontSize: "0.83rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Run migration <strong>0014_vendor_normalization.sql</strong> in your Supabase SQL editor, then reload.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isMigrationNeeded && (
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          <StatChip color="var(--color-accent)" label="Potential matches" count={potentialClusters.length} icon={<ArrowRightLeft size={14} />} />
          <StatChip color="#f59e0b" label="New vendors" count={newCandidateClusters.length} icon={<Plus size={14} />} />
          {totalPending === 0 && <StatChip color="var(--color-success)" label="All clear" count={null} icon={<CheckCircle2 size={14} />} />}
        </div>
      )}

      {isLoading && !isMigrationNeeded && (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ margin: 0, fontSize: "0.85rem" }}>Loading vendor audit data…</p>
        </div>
      )}

      {/* ── Potential Matches ─────────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && potentialClusters.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionHeader icon={<ArrowRightLeft size={16} />} title="Potential Matches" subtitle="Fuzzy score 60–90% or token overlap — confirm or reclassify as new." color="var(--color-accent)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {potentialClusters.map((cluster) => {
              const suggestedVendor = cluster.suggestedVendorId ? vendorsById.get(cluster.suggestedVendorId) : null;
              const isPending = confirmMutation.isPending || treatAsNewMutation.isPending;
              const isExpanded = expandedClusters.has(cluster.key);
              const isAdmin = isAdminOf(cluster.groupId);
              return (
                <div key={cluster.key} style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button
                        onClick={() => toggleExpanded(cluster.key)}
                        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        {isExpanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                        <Tag size={13} color="var(--text-muted)" />
                        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Raw name · {cluster.transactions.length} transaction{cluster.transactions.length !== 1 ? "s" : ""}
                        </span>
                      </button>
                      <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                        {cluster.rawName}
                      </p>
                      {suggestedVendor ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 6, padding: "5px 10px", fontSize: "0.82rem" }}>
                          <Store size={13} color="var(--color-accent)" />
                          <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>{suggestedVendor.canonical_name}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Suggested vendor not found in catalog</span>
                      )}
                    </div>
                    {isAdmin && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
                        {suggestedVendor && (
                          <button disabled={isPending} onClick={() => confirmMutation.mutate({ rawName: cluster.rawName, vendorId: suggestedVendor.id, groupId: cluster.groupId })} style={primaryBtn}>
                            <CheckCircle2 size={13} /> Confirm Match
                          </button>
                        )}
                        <button disabled={isPending} onClick={() => treatAsNewMutation.mutate({ ids: cluster.transactions.map((t) => t.id), rawName: cluster.rawName })} style={ghostBtn}>
                          <Plus size={13} /> Treat as New
                        </button>
                      </div>
                    )}
                  </div>
                  {isExpanded && (
                    <TransactionList transactions={cluster.transactions} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── New Vendor Candidates ─────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && newCandidateClusters.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionHeader icon={<Plus size={16} />} title="New Vendor Candidates" subtitle="No match found — type a canonical name or select an existing vendor." color="#f59e0b" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {newCandidateClusters.map((cluster) => {
              const editedName = getEdit(cluster.key, cluster.rawName);
              const selectedVendor = clusterSelectedVendor[cluster.key] ?? null;
              const isPending = approveMutation.isPending;
              const isExpanded = expandedClusters.has(cluster.key);
              const isAdmin = isAdminOf(cluster.groupId);
              return (
                <div key={cluster.key} style={cardStyle}>
                  <button
                    onClick={() => toggleExpanded(cluster.key)}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    {isExpanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                    <Tag size={13} color="var(--text-muted)" />
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Raw name · {cluster.transactions.length} transaction{cluster.transactions.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  <p style={{ margin: "0 0 14px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                    {cluster.rawName}
                  </p>
                  {isAdmin ? (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <VendorCombobox
                        value={editedName}
                        onChange={(v) => setEdit(cluster.key, v)}
                        onSelect={(v) => selectVendor(cluster.key, v)}
                        vendors={vendorsQuery.data ?? []}
                      />
                      <button
                        disabled={isPending || !editedName.trim()}
                        onClick={() => approveMutation.mutate({
                          rawName: cluster.rawName,
                          canonicalName: editedName,
                          groupId: cluster.groupId,
                          existingVendorId: selectedVendor?.id ?? null,
                        })}
                        style={{
                          ...primaryBtn,
                          background: selectedVendor ? "var(--color-accent)" : "#f59e0b",
                          alignSelf: "flex-end",
                          opacity: isPending || !editedName.trim() ? 0.5 : 1,
                        }}
                      >
                        {selectedVendor ? <><ArrowRightLeft size={13} /> Map to "{selectedVendor.canonical_name}"</> : <><Plus size={13} /> Add to Catalog</>}
                      </button>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>Only group admins can add vendors.</p>
                  )}
                  {isExpanded && (
                    <TransactionList transactions={cluster.transactions} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!isLoading && !isMigrationNeeded && totalPending === 0 && !scanMutation.isPending && (
        <div style={{ textAlign: "center", padding: "56px 24px", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 36 }}>
          <CheckCircle2 size={40} color="var(--color-success)" style={{ margin: "0 auto 14px" }} />
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>All vendors are mapped</p>
          <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>Click <strong>Scan Unmapped Vendors</strong> to check for new receipts.</p>
        </div>
      )}

      {/* ── Vendor Catalog ────────────────────────────────────────────── */}
      {!isLoading && !isMigrationNeeded && (vendorsQuery.data ?? []).length > 0 && (
        <section>
          <SectionHeader icon={<Store size={16} />} title="Vendor Catalog" subtitle="All canonical vendors for your group." color="var(--text-muted)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(vendorsQuery.data ?? []).map((vendor) => {
              const isEditing = editingVendorId === vendor.id;
              const isAdmin = isAdminOf(vendor.group_id);
              return (
                <div key={vendor.id} style={{ ...cardStyle, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <Store size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                  {isEditing ? (
                    <>
                      <input
                        value={vendorEditName}
                        onChange={(e) => setVendorEditName(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && vendorEditName.trim()) renameMutation.mutate({ vendorId: vendor.id, name: vendorEditName });
                          if (e.key === "Escape") setEditingVendorId(null);
                        }}
                      />
                      <button
                        onClick={() => renameMutation.mutate({ vendorId: vendor.id, name: vendorEditName })}
                        disabled={renameMutation.isPending || !vendorEditName.trim()}
                        style={{ ...primaryBtn, padding: "6px 12px" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingVendorId(null)}
                        style={{ ...ghostBtn, padding: "6px 10px" }}
                      >
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: "0.88rem", color: "var(--text-primary)", fontWeight: 500 }}>{vendor.canonical_name}</span>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => { setEditingVendorId(vendor.id); setVendorEditName(vendor.canonical_name); }}
                            style={{ ...ghostBtn, padding: "5px 9px" }}
                            title="Rename vendor"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete "${vendor.canonical_name}"? Affected transactions will need to be re-mapped.`)) {
                                deleteMutation.mutate(vendor.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            style={{ ...ghostBtn, padding: "5px 9px", color: "var(--color-danger)", borderColor: "rgba(248,113,113,0.3)" }}
                            title="Delete vendor"
                          >
                            <Trash2 size={13} />
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── transaction list ──────────────────────────────────────────────────────────

function TransactionList({ transactions }: { transactions: AuditTransaction[] }) {
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-color)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
      {transactions.map((tx) => (
        <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: "0.82rem" }}>
          <span style={{ color: "var(--text-muted)" }}>{tx.date ?? "Unknown date"}</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
            {tx.currency} {(tx.total_amount ?? 0).toFixed(2)}
          </span>
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

const cardStyle: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "16px 18px" };
const primaryBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 7, padding: "8px 13px", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" };
const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: 7, padding: "7px 12px", fontWeight: 500, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 5, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" };
const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 7, padding: "8px 11px", color: "var(--text-primary)", fontSize: "0.88rem", boxSizing: "border-box" };
