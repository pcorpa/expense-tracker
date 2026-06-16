import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
  Camera,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { runVendorNormalizationPipeline } from "../lib/fuzzyMatchVendor";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Vendor, VendorMappingStatus, VendorRawMapping } from "../types";

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
  receipt_image_path: string | null;
  _similarity?: number;
};

type Cluster = {
  key: string;
  rawName: string;
  groupId: string;
  transactions: AuditTransaction[];
  suggestedVendorId: string | null;
  canonicalName: string;
  similarity?: number;
};

// ─── data fetchers ────────────────────────────────────────────────────────────

async function fetchAuditTransactions(): Promise<AuditTransaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, vendor_or_source, vendor_mapping_status, group_id, date, total_amount, currency, receipts(image_url)")
    .in("vendor_mapping_status", ["needs_vendor_review", "new_vendor_candidate"])
    .not("vendor_or_source", "is", null)
    .order("vendor_or_source");
  if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
  return (data ?? []).map((row: any) => ({
    ...row,
    suggested_vendor_id: null,
    receipt_image_path: (row.receipts as any)?.image_url ?? null,
    receipts: undefined,
  }));
}

async function fetchAllVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, group_id, canonical_name, created_at")
    .order("canonical_name");
  if (error) return [];
  return data as Vendor[];
}

async function fetchRawMappings(): Promise<VendorRawMapping[]> {
  const { data, error } = await supabase
    .from("vendor_raw_mappings")
    .select("id, group_id, raw_name, vendor_id, created_at")
    .order("raw_name");
  if (error) return [];
  return data as VendorRawMapping[];
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

  const groupIds = [...new Set(rawTxs.map((t: any) => t.group_id as string))];

  const [{ data: vendors, error: vendorsErr }, { data: rawMappings }] = await Promise.all([
    supabase.from("vendors").select("id, group_id, canonical_name, created_at"),
    supabase.from("vendor_raw_mappings").select("group_id, raw_name, vendor_id").in("group_id", groupIds),
  ]);
  if (vendorsErr) throw vendorsErr;

  const allVendors = (vendors ?? []) as Vendor[];

  // Build a lookup: "groupId|rawNameLower" → vendorId for confirmed mappings
  const confirmedMap = new Map<string, string>();
  for (const m of rawMappings ?? []) {
    confirmedMap.set(`${m.group_id}|${m.raw_name.toLowerCase().trim()}`, m.vendor_id);
  }

  const autoMatchedByVendor = new Map<string, string[]>();
  const reviewByVendor = new Map<string, string[]>();
  const newCandidateIds: string[] = [];
  const fuzzyTxs: typeof rawTxs = [];

  // Step 1: check confirmed mappings first (exact, no fuzzy needed)
  for (const tx of rawTxs) {
    const key = `${tx.group_id}|${(tx.vendor_or_source ?? "").toLowerCase().trim()}`;
    const knownVendorId = confirmedMap.get(key);
    if (knownVendorId) {
      const ids = autoMatchedByVendor.get(knownVendorId) ?? [];
      ids.push(tx.id);
      autoMatchedByVendor.set(knownVendorId, ids);
    } else {
      fuzzyTxs.push(tx);
    }
  }

  // Step 2: fuzzy-match the remainder
  const fuzzyResults = groupIds.flatMap((gid) => {
    const groupTxs = fuzzyTxs.filter((t: any) => t.group_id === gid);
    if (!groupTxs.length) return [];
    const groupVendors = allVendors.filter((v) => v.group_id === gid);
    return runVendorNormalizationPipeline(groupTxs, groupVendors);
  });

  for (const r of fuzzyResults) {
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

  const totalAutoMatched = [...autoMatchedByVendor.values()].reduce((s, ids) => s + ids.length, 0);
  return {
    scanned: rawTxs.length,
    autoMatched: totalAutoMatched,
    needsReview: [...reviewByVendor.values()].reduce((s, ids) => s + ids.length, 0),
    newCandidates: newCandidateIds.length,
  };
}

// ─── combobox component ────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return vendors;
    const q = normalize(value);
    const matches = vendors.filter((v) => {
      const canonical = normalize(v.canonical_name);
      if (canonical.includes(q) || q.includes(canonical)) return true;
      return canonical.split(/[\s\W]+/).filter((w) => w.length >= 3).some((token) => q.includes(token));
    });
    return matches.length > 0 ? matches : vendors;
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
      <label style={labelStyle}>{t("audit.canonical")}</label>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={inputStyle}
        placeholder={placeholder ?? t("audit.typeOrSelectVendor")}
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
  const { t } = useTranslation();
  const qc = useQueryClient();

  const auditQuery = useQuery({ queryKey: ["vendor-audit-txs"], queryFn: fetchAuditTransactions, retry: false });
  const vendorsQuery = useQuery({ queryKey: ["all-vendors"], queryFn: fetchAllVendors, retry: false });
  const rawMappingsQuery = useQuery({ queryKey: ["vendor-raw-mappings"], queryFn: fetchRawMappings, retry: false });
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
    const enrichMap = new Map<string, { vendorId: string | null; similarity: number }>();

    for (const gid of groupIds) {
      const groupTxs = txs.filter((t) => t.group_id === gid);
      const groupVendors = vendors.filter((v) => v.group_id === gid);
      const results = runVendorNormalizationPipeline(groupTxs, groupVendors);
      for (const r of results) enrichMap.set(r.id, { vendorId: r.suggestedVendorId, similarity: r.similarity });
    }

    return txs.map((tx) => ({
      ...tx,
      suggested_vendor_id: enrichMap.get(tx.id)?.vendorId ?? null,
      _similarity: enrichMap.get(tx.id)?.similarity,
    }));
  }, [auditQuery.data, vendorsQuery.data]);

  // ── scan ──────────────────────────────────────────────────────────────────

  const scanMutation = useMutation({
    mutationFn: runScan,
    onSuccess: (stats) => {
      qc.invalidateQueries({ queryKey: ["vendor-audit-txs"] });
      qc.invalidateQueries({ queryKey: ["all-vendors"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      if (stats.scanned === 0) toast.info(t("audit.scanEmpty"));
      else toast.success(t("audit.scanSuccess", { scanned: stats.scanned, autoMatched: stats.autoMatched, needsReview: stats.needsReview, newCandidates: stats.newCandidates }));
    },
    onError: (err: Error) => toast.error(t("audit.scanError", { message: err.message })),
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
      qc.invalidateQueries({ queryKey: ["vendor-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      toast.success(t("audit.confirmSuccess", { rawName }));
    },
    onError: (err: Error) => toast.error(t("audit.actionFailed", { message: err.message })),
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
      toast.info(t("audit.movedToNew", { rawName }));
    },
    onError: (err: Error) => toast.error(t("audit.actionFailed", { message: err.message })),
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
      qc.invalidateQueries({ queryKey: ["vendor-raw-mappings"] });
      toast.success(existingVendorId ? t("audit.mappedToVendor", { name: canonicalName }) : t("audit.addedToVendorCatalog", { name: canonicalName }));
    },
    onError: (err: Error) => toast.error(t("audit.actionFailed", { message: err.message })),
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
      toast.success(t("audit.vendorRenamed"));
    },
    onError: (err: Error) => toast.error(t("audit.actionFailed", { message: err.message })),
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
      qc.invalidateQueries({ queryKey: ["vendor-raw-mappings"] });
      qc.invalidateQueries({ queryKey: ["pending-vendor-count"] });
      toast.success(t("audit.vendorDeleted"));
    },
    onError: (err: Error) => toast.error(t("audit.actionFailed", { message: err.message })),
  });

  // ── delete raw mapping ────────────────────────────────────────────────────

  const deleteMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase.rpc("delete_vendor_raw_mapping", { p_mapping_id: mappingId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-raw-mappings"] });
      toast.success(t("audit.vendorMappingRemoved"));
    },
    onError: (err: Error) => toast.error(t("audit.actionFailed", { message: err.message })),
  });

  // ── search ────────────────────────────────────────────────────────────────

  const [auditSearch, setAuditSearch] = useState("");

  // ── cluster state ─────────────────────────────────────────────────────────

  const [clusterEdits, setClusterEdits] = useState<Record<string, string>>({});
  const [clusterSelectedVendor, setClusterSelectedVendor] = useState<Record<string, Vendor | null>>({});
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [overridingClusters, setOverridingClusters] = useState<Set<string>>(new Set());
  const [overrideEdits, setOverrideEdits] = useState<Record<string, string>>({});
  const [overrideSelectedVendor, setOverrideSelectedVendor] = useState<Record<string, Vendor | null>>({});

  // vendor catalog edit state
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorEditName, setVendorEditName] = useState("");

  const [pendingConfirm, setPendingConfirm] = useState<{ body: string; onConfirm: () => void } | null>(null);

  // lightbox state
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(false);

  const openReceipt = useCallback(async (imagePath: string) => {
    setLightboxLoading(true);
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(imagePath, 120);
    setLightboxLoading(false);
    if (error || !data?.signedUrl) {
      toast.error(t("audit.receiptLoadError"));
      return;
    }
    setLightboxUrl(data.signedUrl);
  }, []);

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
        map.set(key, { key, rawName: tx.vendor_or_source ?? "", groupId: tx.group_id, transactions: [], suggestedVendorId: tx.suggested_vendor_id, canonicalName: tx.vendor_or_source ?? "", similarity: tx._similarity });
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

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {t("audit.vendorAuditTitle")}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            {t("audit.vendorAuditDesc")}
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending || isMigrationNeeded}
          style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, fontSize: "0.85rem", cursor: scanMutation.isPending ? "wait" : "pointer", flexShrink: 0, opacity: scanMutation.isPending ? 0.7 : 1 }}
        >
          {scanMutation.isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ScanSearch size={15} />}
          {scanMutation.isPending ? t("audit.scanning") : t("audit.scanVendorBtn")}
        </button>
      </div>

      {isMigrationNeeded && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "16px 18px", marginBottom: 24 }}>
          <AlertTriangle size={18} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--color-danger)", fontSize: "0.9rem" }}>{t("audit.migrationTitle")}</p>
            <p style={{ margin: "0 0 10px", fontSize: "0.83rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Run migration <strong>0014_vendor_normalization.sql</strong> in your Supabase SQL editor, then reload.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isMigrationNeeded && (
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          <StatChip color="var(--color-accent)" label={t("audit.potentialMatchesChip")} count={potentialClusters.length} icon={<ArrowRightLeft size={14} />} />
          <StatChip color="#f59e0b" label={t("audit.newVendorsChip")} count={newCandidateClusters.length} icon={<Plus size={14} />} />
          {totalPending === 0 && <StatChip color="var(--color-success)" label={t("audit.allClearShort")} count={null} icon={<CheckCircle2 size={14} />} />}
        </div>
      )}

      {isLoading && !isMigrationNeeded && (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ margin: 0, fontSize: "0.85rem" }}>{t("audit.loadingVendorAudit")}</p>
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

      {/* ── Potential Matches ─────────────────────────────────────────── */}
      {visiblePotential.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionHeader icon={<ArrowRightLeft size={16} />} title={t("audit.potentialMatchesSection")} subtitle={t("audit.vendorPotentialDesc")} color="var(--color-accent)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visiblePotential.map((cluster) => {
              const suggestedVendor = cluster.suggestedVendorId ? vendorsById.get(cluster.suggestedVendorId) : null;
              const isPending = confirmMutation.isPending || treatAsNewMutation.isPending;
              const isExpanded = expandedClusters.has(cluster.key);
              const isAdmin = isAdminOf(cluster.groupId);
              const isOverriding = overridingClusters.has(cluster.key);
              const overrideEdit = overrideEdits[cluster.key] ?? "";
              const overrideVendor = overrideSelectedVendor[cluster.key] ?? null;
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
                          {t("audit.rawNameTransCount", { count: cluster.transactions.length })}
                        </span>
                      </button>
                      <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: "0.95rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
                        {cluster.rawName}
                      </p>
                      {!isOverriding && (suggestedVendor ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 6, padding: "5px 10px", fontSize: "0.82rem" }}>
                            <Store size={13} color="var(--color-accent)" />
                            <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>{suggestedVendor.canonical_name}</span>
                            {cluster.similarity !== undefined && (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>· {Math.round(cluster.similarity * 100)}%</span>
                            )}
                          </div>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                setOverridingClusters((prev) => { const s = new Set(prev); s.add(cluster.key); return s; });
                                setOverrideEdits((prev) => ({ ...prev, [cluster.key]: "" }));
                                setOverrideSelectedVendor((prev) => ({ ...prev, [cluster.key]: null }));
                              }}
                              style={{ background: "none", border: "none", padding: 0, fontSize: "0.75rem", color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" }}
                            >
                              {t("audit.wrongMatch")}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{t("audit.vendorNotFound")}</span>
                      ))}
                      {isOverriding && isAdmin && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 4 }}>
                          <VendorCombobox
                            value={overrideEdit}
                            onChange={(v) => {
                              setOverrideEdits((prev) => ({ ...prev, [cluster.key]: v }));
                              setOverrideSelectedVendor((prev) => ({ ...prev, [cluster.key]: null }));
                            }}
                            onSelect={(v) => {
                              setOverrideEdits((prev) => ({ ...prev, [cluster.key]: v.canonical_name }));
                              setOverrideSelectedVendor((prev) => ({ ...prev, [cluster.key]: v }));
                            }}
                            vendors={(vendorsQuery.data ?? []).filter((v) => v.group_id === cluster.groupId)}
                            placeholder={t("audit.selectCorrectVendor")}
                          />
                          <div style={{ display: "flex", gap: 7, alignSelf: "flex-end" }}>
                            <button
                              disabled={isPending || !overrideEdit.trim()}
                              onClick={() => {
                                approveMutation.mutate({
                                  rawName: cluster.rawName,
                                  canonicalName: overrideEdit,
                                  groupId: cluster.groupId,
                                  existingVendorId: overrideVendor?.id ?? null,
                                });
                                setOverridingClusters((prev) => { const s = new Set(prev); s.delete(cluster.key); return s; });
                              }}
                              style={{ ...primaryBtn, background: overrideVendor ? "var(--color-accent)" : "#f59e0b", opacity: !overrideEdit.trim() || isPending ? 0.5 : 1 }}
                            >
                              {overrideVendor ? <><ArrowRightLeft size={13} /> {t("audit.mapTo", { name: overrideVendor.canonical_name })}</> : <><Plus size={13} /> {t("audit.addToCatalog")}</>}
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
                    {isAdmin && !isOverriding && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
                        {suggestedVendor && (
                          <button disabled={isPending} onClick={() => confirmMutation.mutate({ rawName: cluster.rawName, vendorId: suggestedVendor.id, groupId: cluster.groupId })} style={primaryBtn}>
                            <CheckCircle2 size={13} /> {t("audit.confirmMatch")}
                          </button>
                        )}
                        <button disabled={isPending} onClick={() => treatAsNewMutation.mutate({ ids: cluster.transactions.map((tx) => tx.id), rawName: cluster.rawName })} style={ghostBtn}>
                          <Plus size={13} /> {t("audit.treatAsNew")}
                        </button>
                      </div>
                    )}
                  </div>
                  {isExpanded && (
                    <TransactionList transactions={cluster.transactions} onViewReceipt={openReceipt} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── New Vendor Candidates ─────────────────────────────────────── */}
      {visibleNew.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionHeader icon={<Plus size={16} />} title={t("audit.newVendorSection")} subtitle={t("audit.newVendorDesc")} color="#f59e0b" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibleNew.map((cluster) => {
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
                      {t("audit.rawNameTransCount", { count: cluster.transactions.length })}
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
                        {selectedVendor ? <><ArrowRightLeft size={13} /> {t("audit.mapTo", { name: selectedVendor.canonical_name })}</> : <><Plus size={13} /> {t("audit.addToCatalog")}</>}
                      </button>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>{t("audit.onlyAdminsAddVendor")}</p>
                  )}
                  {isExpanded && (
                    <TransactionList transactions={cluster.transactions} onViewReceipt={openReceipt} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {auditSearch.trim() && visiblePotential.length === 0 && visibleNew.length === 0 && totalPending > 0 && (
        <div style={{ textAlign: "center", padding: "32px 24px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {t("audit.noSearchResults", { query: auditSearch })}
        </div>
      )}

      {totalPending === 0 && !scanMutation.isPending && (
        <div style={{ textAlign: "center", padding: "56px 24px", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
          <CheckCircle2 size={40} color="var(--color-success)" style={{ margin: "0 auto 14px" }} />
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>{t("audit.allVendorsMapped")}</p>
          <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>{t("audit.allVendorsMappedDesc")}</p>
        </div>
      )}

          </div>{/* end LEFT */}

          {/* ── RIGHT: catalog + mappings (sticky) ─────────────────────── */}
          <div style={{ position: "sticky", top: 24, maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>

      {/* ── Vendor Catalog ────────────────────────────────────────────── */}
      {(vendorsQuery.data ?? []).length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <SectionHeader icon={<Store size={16} />} title={t("audit.vendorCatalogSection")} subtitle={t("audit.vendorCatalogCount", { count: (vendorsQuery.data ?? []).length })} color="var(--text-muted)" />
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
                        {t("common.save")}
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
                            onClick={() => setPendingConfirm({
                              body: t("audit.deleteVendorConfirm", { name: vendor.canonical_name }),
                              onConfirm: () => deleteMutation.mutate(vendor.id),
                            })}
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

      {/* ── Confirmed Mappings ───────────────────────────────────────── */}
      {(rawMappingsQuery.data ?? []).length > 0 && (
        <section>
          <SectionHeader
            icon={<CheckCircle2 size={16} />}
            title={t("audit.confirmedMappingsSection")}
            subtitle={t("audit.vendorConfirmedMappingsDesc")}
            color="var(--color-success)"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(rawMappingsQuery.data ?? []).map((mapping) => {
              const vendor = vendorsById.get(mapping.vendor_id);
              const isAdmin = isAdminOf(mapping.group_id);
              return (
                <div key={mapping.id} style={{ ...cardStyle, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <Tag size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: "0.83rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={mapping.raw_name}>
                    {mapping.raw_name}
                  </span>
                  <ArrowRightLeft size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: "0.83rem", fontWeight: 600, color: "var(--color-success)", flexShrink: 0 }}>
                    {vendor?.canonical_name ?? t("audit.unknownVendor")}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={() => setPendingConfirm({
                        body: t("audit.removeMappingVendorConfirm", { raw: mapping.raw_name, vendor: vendor?.canonical_name ?? "" }),
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

          </div>{/* end RIGHT */}
        </div>
      )}{/* end !isLoading && !isMigrationNeeded */}

      <ConfirmModal
        open={pendingConfirm !== null}
        title={t("common.delete")}
        confirmLabel={t("common.delete")}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null); }}
        onCancel={() => setPendingConfirm(null)}
      >
        {pendingConfirm?.body}
      </ConfirmModal>

      {lightboxLoading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <Loader2 size={32} color="#fff" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
          >
            <X size={18} />
          </button>
          <img
            src={lightboxUrl}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 8, objectFit: "contain", boxShadow: "0 16px 48px rgba(0,0,0,0.6)" }}
            alt="Receipt"
          />
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) { .audit-layout { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

// ─── transaction list ──────────────────────────────────────────────────────────

function TransactionList({ transactions, onViewReceipt }: { transactions: AuditTransaction[]; onViewReceipt: (path: string) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-color)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
      {transactions.map((tx) => (
        <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: "0.82rem" }}>
          <span style={{ color: "var(--text-muted)" }}>{tx.date ?? t("audit.unknownDate")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              {tx.currency} {(tx.total_amount ?? 0).toFixed(2)}
            </span>
            {tx.receipt_image_path && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewReceipt(tx.receipt_image_path!); }}
                title="View receipt image"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex", alignItems: "center" }}
              >
                <Camera size={14} />
              </button>
            )}
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

const cardStyle: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "16px 18px" };
const primaryBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 7, padding: "8px 13px", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" };
const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: 7, padding: "7px 12px", fontWeight: 500, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 5, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" };
const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 7, padding: "8px 11px", color: "var(--text-primary)", fontSize: "0.88rem", boxSizing: "border-box" };
