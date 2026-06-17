import { supabase } from '../lib/supabase';
import type { Transaction, VendorMappingStatus } from '../types';

export interface GetTransactionsParams {
  groupIds: string[];
  type?: 'expense' | 'income';
  vendorSearch?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'date' | 'amount';
  page: number;
  pageSize: number;
}

export async function getTransactions(
  params: GetTransactionsParams,
): Promise<{ data: Transaction[]; count: number }> {
  const { groupIds, type, vendorSearch, dateFrom, dateTo, sortBy = 'date', page, pageSize } = params;

  let query = supabase
    .from('transactions')
    .select('*, transaction_items(*), receipts(image_url)', { count: 'exact' })
    .in('group_id', groupIds)
    .order(sortBy === 'amount' ? 'total_amount' : 'date', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (type) query = query.eq('type', type);
  if (vendorSearch) query = query.ilike('vendor_or_source', `%${vendorSearch}%`);
  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);

  const { data, count, error } = await query;
  if (error) throw error;
  return { data: (data ?? []) as Transaction[], count: count ?? 0 };
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

export interface VendorAuditTransaction {
  id: string;
  vendor_or_source: string | null;
  vendor_mapping_status: VendorMappingStatus;
  suggested_vendor_id: string | null;
  group_id: string;
  date: string | null;
  total_amount: number | null;
  currency: string;
  receipt_image_path: string | null;
}

export async function getVendorAuditTransactions(): Promise<VendorAuditTransaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, vendor_or_source, vendor_mapping_status, group_id, date, total_amount, currency, receipts(image_url)')
    .in('vendor_mapping_status', ['needs_vendor_review', 'new_vendor_candidate'])
    .not('vendor_or_source', 'is', null)
    .order('vendor_or_source');
  if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
  return (data ?? []).map((row: any) => ({
    ...row,
    suggested_vendor_id: null,
    receipt_image_path: (row.receipts as any)?.image_url ?? null,
    receipts: undefined,
  }));
}

export async function getUnmappedTransactions(): Promise<Array<{ id: string; vendor_or_source: string; group_id: string }>> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, vendor_or_source, group_id')
    .is('vendor_mapping_status', null)
    .not('vendor_or_source', 'is', null)
    .neq('vendor_or_source', 'Unknown');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; vendor_or_source: string; group_id: string }>;
}

export async function getReceiptSignedUrl(imagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(imagePath, 120);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Failed to load receipt');
  return data.signedUrl;
}

export async function updateTransactionsVendorStatus(params: {
  ids: string[];
  status: VendorMappingStatus;
  vendorId?: string;
}): Promise<void> {
  const update: Record<string, unknown> = { vendor_mapping_status: params.status };
  if (params.vendorId) update.vendor_id = params.vendorId;
  const { error } = await supabase
    .from('transactions')
    .update(update)
    .in('id', params.ids);
  if (error) throw error;
}
