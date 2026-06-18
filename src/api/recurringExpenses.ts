import { supabase } from '../lib/supabase';
import { generateDueTransactions } from '../lib/recurringExpenses';
import type { RecurringExpense, RecurringExpenseType, RecurringFrequency } from '../types';

export interface CreateRecurringExpensePayload {
  group_id: string;
  user_id: string;
  name: string;
  vendor_name: string | null;
  type: RecurringExpenseType;
  category: string;
  currency: string;
  amount: number;
  frequency: RecurringFrequency;
  start_date: string;
  notes: string | null;
  total_purchase_amount?: number;
  total_installments?: number;
  last_generated_date?: string;
}

export interface UpdateRecurringExpensePayload {
  name: string;
  vendor_name: string | null;
  category: string;
  currency: string;
  amount: number;
  frequency: RecurringFrequency;
  start_date: string;
  notes: string | null;
  updated_at: string;
  total_purchase_amount?: number;
  total_installments?: number;
  last_generated_date?: string | null;
}

export async function getRecurringExpenses(groupIds: string[]): Promise<RecurringExpense[]> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .in('group_id', groupIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RecurringExpense[];
}

export async function getRecurringExpense(id: string): Promise<RecurringExpense> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as RecurringExpense;
}

export async function createRecurringExpense(payload: CreateRecurringExpensePayload): Promise<void> {
  const { data: inserted, error } = await supabase
    .from('recurring_expenses')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  await generateDueTransactions(inserted as RecurringExpense, supabase, new Date());
}

export async function updateRecurringExpense(params: {
  id: string;
  payload: UpdateRecurringExpensePayload;
  deleteInstallmentsAfter?: number;
}): Promise<void> {
  if (params.deleteInstallmentsAfter !== undefined) {
    const { data: txsToDelete } = await supabase
      .from('transactions')
      .select('id')
      .eq('recurring_expense_id', params.id)
      .gt('installment_number', params.deleteInstallmentsAfter);
    if (txsToDelete && txsToDelete.length > 0) {
      const txIds = (txsToDelete as Array<{ id: string }>).map((tx) => tx.id);
      await supabase.from('transaction_items').delete().in('transaction_id', txIds);
      await supabase.from('transactions').delete().in('id', txIds);
    }
  }
  const { error } = await supabase
    .from('recurring_expenses')
    .update(params.payload)
    .eq('id', params.id);
  if (error) throw error;
}

export async function cancelRecurringExpense(id: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('recurring_expenses')
    .update({
      is_active: false,
      end_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteRecurringExpense(params: {
  id: string;
  deleteTransactions: boolean;
}): Promise<void> {
  if (params.deleteTransactions) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('id')
      .eq('recurring_expense_id', params.id);
    if (txs && txs.length > 0) {
      const txIds = (txs as Array<{ id: string }>).map((tx) => tx.id);
      await supabase.from('transaction_items').delete().in('transaction_id', txIds);
      await supabase.from('transactions').delete().in('id', txIds);
    }
  }
  const { error } = await supabase
    .from('recurring_expenses')
    .delete()
    .eq('id', params.id);
  if (error) throw error;
}

export async function generateDueForAll(activeItems: RecurringExpense[]): Promise<void> {
  await Promise.all(
    activeItems.map((re) => generateDueTransactions(re, supabase, new Date())),
  );
}
