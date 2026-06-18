import { supabase } from '../lib/supabase';
import type { Transaction, TransactionType, VendorMappingStatus } from '../types';

export interface TransactionHeader {
  id: string;
  vendor_or_source: string | null;
  date: string | null;
  type: TransactionType;
  total_amount: number | null;
}

export interface TransactionItemFields {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
}

export interface SubmitTransactionItem {
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
}

export interface SubmitTransactionPayload {
  groupId: string;
  userId: string;
  type: TransactionType;
  vendor_or_source: string;
  date: string;
  currency: string;
  items: SubmitTransactionItem[];
}

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

export async function getTransactionHeader(id: string): Promise<TransactionHeader> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, vendor_or_source, date, type, total_amount')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as TransactionHeader;
}

export async function getTransactionItem(id: string): Promise<TransactionItemFields> {
  const { data, error } = await supabase
    .from('transaction_items')
    .select('id, name, category, quantity, unit_price, item_total')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as TransactionItemFields;
}

export async function updateTransactionHeader(params: {
  id: string;
  vendor_or_source: string | null;
  date: string | null;
  type: TransactionType;
  total_amount: number | null;
}): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({
      vendor_or_source: params.vendor_or_source,
      date: params.date,
      type: params.type,
      total_amount: params.total_amount,
    })
    .eq('id', params.id);
  if (error) throw error;
}

export async function upsertTransactionItem(params: {
  id: string;
  transaction_id: string;
  name: string;
  category: string;
  quantity: number;
  unit_price: number;
  item_total: number;
}): Promise<void> {
  const { error } = await supabase
    .from('transaction_items')
    .upsert(params, { onConflict: 'id' });
  if (error) throw error;
}

export async function submitTransaction(payload: SubmitTransactionPayload): Promise<void> {
  const total_amount = payload.items.reduce((sum, item) => sum + item.item_total, 0);

  const { data: txData, error: txError } = await supabase
    .from('transactions')
    .insert({
      user_id: payload.userId,
      group_id: payload.groupId,
      type: payload.type,
      is_reviewed: false,
      vendor_or_source: payload.vendor_or_source,
      date: payload.date,
      total_amount,
      currency: payload.currency,
    })
    .select()
    .single();
  if (txError) throw txError;

  const itemsToInsert = await Promise.all(
    payload.items.map(async (item) => {
      let productId: string | null = null;
      try {
        const { data: existingProduct } = await supabase
          .from('products')
          .select('id')
          .eq('group_id', payload.groupId)
          .eq('name', item.name)
          .single();
        if (existingProduct) {
          productId = (existingProduct as { id: string }).id;
        } else {
          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert({ group_id: payload.groupId, name: item.name, category: item.category })
            .select()
            .single();
          if (!productError && newProduct) productId = (newProduct as { id: string }).id;
        }
      } catch {
        // product_id stays null
      }
      return {
        transaction_id: txData.id,
        product_id: productId,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        unit_price: item.unit_price,
        item_total: item.item_total,
      };
    }),
  );

  const { error: itemsError } = await supabase
    .from('transaction_items')
    .insert(itemsToInsert);
  if (itemsError) throw itemsError;
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
