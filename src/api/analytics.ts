import { supabase } from '../lib/supabase';
import type { Transaction, Vendor } from '../types';

export interface AnalyticsProfileInfo {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface AnalyticsData {
  transactions: Transaction[];
  vendors: Vendor[];
  profileMap: Record<string, AnalyticsProfileInfo>;
}

export async function getAnalyticsData(groupIds: string[]): Promise<AnalyticsData> {
  const [txRes, vendorRes, memberRes] = await Promise.all([
    supabase.from('transactions').select('*, transaction_items(*)').in('group_id', groupIds),
    supabase.from('vendors').select('*').in('group_id', groupIds),
    supabase.from('group_members').select('user_id').in('group_id', groupIds),
  ]);

  if (txRes.error) throw txRes.error;
  if (vendorRes.error) throw vendorRes.error;
  if (memberRes.error) throw memberRes.error;

  const userIds = [...new Set((memberRes.data ?? []).map((m: any) => m.user_id as string))];

  const { data: profilesData, error: profilesError } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email')
    .in('id', userIds);
  if (profilesError) throw profilesError;

  const profileMap: Record<string, AnalyticsProfileInfo> = {};
  for (const p of profilesData ?? []) {
    const row = p as { id: string; first_name: string | null; last_name: string | null; email: string };
    profileMap[row.id] = {
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
    };
  }

  return {
    transactions: (txRes.data ?? []) as Transaction[],
    vendors: (vendorRes.data ?? []) as Vendor[],
    profileMap,
  };
}
