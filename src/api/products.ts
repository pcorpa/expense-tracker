import { supabase } from '../lib/supabase';
import { runNormalizationPipeline } from '../lib/fuzzyMatch';
import type { Product, ProductRawMapping, MappingStatus } from '../types';
import type { ScanStats } from './vendors';

export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, group_id, created_at')
    .order('name');
  if (error) {
    console.error('[api/products] getProducts ERROR:', { message: error.message });
    return [];
  }
  return data as Product[];
}

export async function getProductMappings(): Promise<ProductRawMapping[]> {
  const { data, error } = await supabase
    .from('product_raw_mappings')
    .select('id, group_id, raw_name, product_id, created_at')
    .order('raw_name');
  if (error) return [];
  return data as ProductRawMapping[];
}

export interface ProductAuditItem {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
  mapping_status: MappingStatus;
  suggested_product_id: string | null;
  transactions: { group_id: string };
}

export async function getProductAuditItems(): Promise<ProductAuditItem[]> {
  const { data, error } = await supabase
    .from('transaction_items')
    .select('id, name, category, quantity, unit_price, item_total, mapping_status, suggested_product_id, transactions!inner(group_id)')
    .in('mapping_status', ['needs_mapping_review', 'new_product_candidate'])
    .order('name');
  if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
  return data as unknown as ProductAuditItem[];
}

export async function getPendingProductAuditCount(): Promise<number> {
  const { count, error } = await supabase
    .from('transaction_items')
    .select('id', { count: 'exact', head: true })
    .in('mapping_status', ['needs_mapping_review', 'new_product_candidate']);
  if (error) return 0;
  return count ?? 0;
}

export async function confirmProductMatch(params: {
  rawName: string;
  productId: string;
  groupId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('confirm_product_match', {
    p_raw_name: params.rawName,
    p_product_id: params.productId,
    p_group_id: params.groupId,
  });
  if (error) throw error;
}

export async function approveProductMapping(params: {
  rawName: string;
  canonicalName: string;
  category: string;
  groupId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('approve_product_mapping', {
    p_raw_name: params.rawName,
    p_canonical_name: params.canonicalName.trim(),
    p_category: params.category,
    p_group_id: params.groupId,
  });
  if (error) throw error;
}

export async function renameProduct(productId: string, name: string, category: string): Promise<void> {
  const { error } = await supabase.rpc('rename_product', {
    p_product_id: productId,
    p_canonical_name: name.trim(),
    p_category: category,
  });
  if (error) throw error;
}

export async function deleteProduct(productId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_product', { p_product_id: productId });
  if (error) throw error;
}

export async function deleteProductMapping(mappingId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_product_raw_mapping', { p_mapping_id: mappingId });
  if (error) throw error;
}

export async function resetTransactionItemsToNewCandidate(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('transaction_items')
    .update({ mapping_status: 'new_product_candidate', suggested_product_id: null })
    .in('id', ids);
  if (error) throw error;
}

async function updateTransactionItemsMappingStatus(params: {
  ids: string[];
  status: MappingStatus;
  productId?: string;
}): Promise<void> {
  let update: Record<string, unknown>;
  if (params.status === 'auto_matched') {
    update = { product_id: params.productId, mapping_status: 'auto_matched', suggested_product_id: null };
  } else if (params.status === 'needs_mapping_review') {
    update = { mapping_status: 'needs_mapping_review', suggested_product_id: params.productId ?? null };
  } else {
    update = { mapping_status: params.status };
  }
  const { error } = await supabase.from('transaction_items').update(update).in('id', params.ids);
  if (error) throw error;
}

export async function getProductSuggestions(params: {
  search: string;
  groupId: string;
}): Promise<string[]> {
  const { data, error } = await supabase
    .from('products')
    .select('name')
    .eq('group_id', params.groupId)
    .ilike('name', `%${params.search}%`)
    .limit(5);
  if (error || !data) return [];
  const uniqueNames = Array.from(new Set(data.map((item: any) => item.name as string)));
  return uniqueNames;
}

export async function runProductScan(): Promise<ScanStats> {
  const { data: rawItemsRaw, error: itemsErr } = await supabase
    .from('transaction_items')
    .select('id, name, transactions!inner(group_id)')
    .is('mapping_status', null)
    .is('product_id', null)
    .neq('name', 'Unknown');

  if (itemsErr) throw itemsErr;
  if (!rawItemsRaw || rawItemsRaw.length === 0) {
    return { scanned: 0, autoMatched: 0, needsReview: 0, newCandidates: 0 };
  }

  const rawItems = rawItemsRaw as unknown as Array<{ id: string; name: string; transactions: { group_id: string } }>;
  const groupIds = [...new Set(rawItems.map((i) => i.transactions.group_id))];

  const [{ data: products, error: productsErr }, { data: rawMappings }] = await Promise.all([
    supabase.from('products').select('id, name, category, group_id, created_at'),
    supabase.from('product_raw_mappings').select('group_id, raw_name, product_id').in('group_id', groupIds),
  ]);

  if (productsErr) throw productsErr;

  const confirmedMap = new Map<string, string>();
  for (const m of rawMappings ?? []) {
    confirmedMap.set(`${m.group_id}|${m.raw_name.toLowerCase().trim()}`, m.product_id);
  }

  const autoMatchedByProduct = new Map<string, string[]>();
  const reviewByProduct = new Map<string, string[]>();
  const newCandidateIds: string[] = [];
  const fuzzyItems: Array<{ id: string; name: string }> = [];

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

  const results = runNormalizationPipeline(fuzzyItems, (products ?? []) as Product[]);

  for (const r of results) {
    if (r.status === 'auto_matched' && r.suggestedProductId) {
      const ids = autoMatchedByProduct.get(r.suggestedProductId) ?? [];
      ids.push(r.id);
      autoMatchedByProduct.set(r.suggestedProductId, ids);
    } else if (r.status === 'needs_mapping_review' && r.suggestedProductId) {
      const ids = reviewByProduct.get(r.suggestedProductId) ?? [];
      ids.push(r.id);
      reviewByProduct.set(r.suggestedProductId, ids);
    } else {
      newCandidateIds.push(r.id);
    }
  }

  const updates: Promise<void>[] = [];

  for (const [productId, ids] of autoMatchedByProduct) {
    updates.push(updateTransactionItemsMappingStatus({ ids, status: 'auto_matched', productId }));
  }
  for (const [productId, ids] of reviewByProduct) {
    updates.push(updateTransactionItemsMappingStatus({ ids, status: 'needs_mapping_review', productId }));
  }
  if (newCandidateIds.length > 0) {
    updates.push(updateTransactionItemsMappingStatus({ ids: newCandidateIds, status: 'new_product_candidate' }));
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
