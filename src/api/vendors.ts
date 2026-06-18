import { supabase } from '../lib/supabase';
import { runVendorNormalizationPipeline } from '../lib/fuzzyMatchVendor';
import { getUnmappedTransactions, updateTransactionsVendorStatus, getReceiptSignedUrl } from './transactions';
export { getReceiptSignedUrl };
import type { Vendor, VendorRawMapping } from '../types';

export interface ScanStats {
  scanned: number;
  autoMatched: number;
  needsReview: number;
  newCandidates: number;
}

export async function getVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, group_id, canonical_name, created_at')
    .order('canonical_name');
  if (error) return [];
  return data as Vendor[];
}

export async function getVendorMappings(): Promise<VendorRawMapping[]> {
  const { data, error } = await supabase
    .from('vendor_raw_mappings')
    .select('id, group_id, raw_name, vendor_id, created_at')
    .order('raw_name');
  if (error) return [];
  return data as VendorRawMapping[];
}

export async function getPendingVendorCount(): Promise<number> {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .in('vendor_mapping_status', ['needs_vendor_review', 'new_vendor_candidate']);
  if (error) throw error;
  return count ?? 0;
}

export async function confirmVendorMatch(params: {
  rawName: string;
  vendorId: string;
  groupId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('confirm_vendor_match', {
    p_raw_name: params.rawName,
    p_vendor_id: params.vendorId,
    p_group_id: params.groupId,
  });
  if (error) throw error;
}

export async function approveVendorMapping(params: {
  rawName: string;
  canonicalName: string;
  groupId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('approve_vendor_mapping', {
    p_raw_name: params.rawName,
    p_canonical_name: params.canonicalName.trim(),
    p_group_id: params.groupId,
  });
  if (error) throw error;
}

export async function renameVendor(vendorId: string, canonicalName: string): Promise<void> {
  const { error } = await supabase.rpc('rename_vendor', {
    p_vendor_id: vendorId,
    p_canonical_name: canonicalName.trim(),
  });
  if (error) throw error;
}

export async function deleteVendor(vendorId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_vendor', { p_vendor_id: vendorId });
  if (error) throw error;
}

export async function deleteVendorMapping(mappingId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_vendor_raw_mapping', { p_mapping_id: mappingId });
  if (error) throw error;
}

export async function runVendorScan(): Promise<ScanStats> {
  const rawTxs = await getUnmappedTransactions();
  if (!rawTxs || rawTxs.length === 0) {
    return { scanned: 0, autoMatched: 0, needsReview: 0, newCandidates: 0 };
  }

  const groupIds = [...new Set(rawTxs.map((t) => t.group_id))];

  const [{ data: vendors, error: vendorsErr }, { data: rawMappings }] = await Promise.all([
    supabase.from('vendors').select('id, group_id, canonical_name, created_at'),
    supabase.from('vendor_raw_mappings').select('group_id, raw_name, vendor_id').in('group_id', groupIds),
  ]);
  if (vendorsErr) throw vendorsErr;

  const allVendors = (vendors ?? []) as Vendor[];

  const confirmedMap = new Map<string, string>();
  for (const m of rawMappings ?? []) {
    confirmedMap.set(`${m.group_id}|${m.raw_name.toLowerCase().trim()}`, m.vendor_id);
  }

  const autoMatchedByVendor = new Map<string, string[]>();
  const reviewByVendor = new Map<string, string[]>();
  const newCandidateIds: string[] = [];
  const fuzzyTxs: typeof rawTxs = [];

  for (const tx of rawTxs) {
    const key = `${tx.group_id}|${(tx.vendor_or_source ?? '').toLowerCase().trim()}`;
    const knownVendorId = confirmedMap.get(key);
    if (knownVendorId) {
      const ids = autoMatchedByVendor.get(knownVendorId) ?? [];
      ids.push(tx.id);
      autoMatchedByVendor.set(knownVendorId, ids);
    } else {
      fuzzyTxs.push(tx);
    }
  }

  const fuzzyResults = groupIds.flatMap((gid) => {
    const groupTxs = fuzzyTxs.filter((t) => t.group_id === gid);
    if (!groupTxs.length) return [];
    const groupVendors = allVendors.filter((v) => v.group_id === gid);
    return runVendorNormalizationPipeline(groupTxs, groupVendors);
  });

  for (const r of fuzzyResults) {
    if (r.status === 'auto_matched' && r.suggestedVendorId) {
      const ids = autoMatchedByVendor.get(r.suggestedVendorId) ?? [];
      ids.push(r.id);
      autoMatchedByVendor.set(r.suggestedVendorId, ids);
    } else if (r.status === 'needs_vendor_review') {
      const ids = reviewByVendor.get(r.suggestedVendorId ?? '__none__') ?? [];
      ids.push(r.id);
      reviewByVendor.set(r.suggestedVendorId ?? '__none__', ids);
    } else {
      newCandidateIds.push(r.id);
    }
  }

  const updates: Promise<void>[] = [];

  for (const [vendorId, ids] of autoMatchedByVendor) {
    updates.push(updateTransactionsVendorStatus({ ids, status: 'auto_matched', vendorId }));
  }
  for (const ids of reviewByVendor.values()) {
    updates.push(updateTransactionsVendorStatus({ ids, status: 'needs_vendor_review' }));
  }
  if (newCandidateIds.length > 0) {
    updates.push(updateTransactionsVendorStatus({ ids: newCandidateIds, status: 'new_vendor_candidate' }));
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
