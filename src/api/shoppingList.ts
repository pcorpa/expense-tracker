import { supabase } from '../lib/supabase';
import type { Transaction, Product } from '../types';

export async function getShoppingListData(params: {
  groupIds: string[];
  cutoffDate: string;
}): Promise<{ transactions: Transaction[]; products: Product[] }> {
  const [txRes, prodRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('*, transaction_items(*)')
      .in('group_id', params.groupIds)
      .eq('is_reviewed', true)
      .eq('type', 'expense')
      .gte('date', params.cutoffDate),
    supabase
      .from('products')
      .select('id, name, category, created_at')
      .in('group_id', params.groupIds),
  ]);

  if (txRes.error) throw txRes.error;
  if (prodRes.error) throw prodRes.error;

  return {
    transactions: (txRes.data ?? []) as Transaction[],
    products: (prodRes.data ?? []) as Product[],
  };
}
