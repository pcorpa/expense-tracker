import { supabase } from "../lib/supabase";

export interface ReviewItem {
  id: string;
  transaction_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
  created_at: string;
}

export interface ReviewTransaction {
  id: string;
  vendor_or_source: string | null;
  date: string | null;
  type: string;
  total_amount: number | null;
  receipt_id: string | null;
  created_at: string;
  is_reviewed: boolean;
  transaction_items: ReviewItem[];
  receipts?: { status: string }[];
}

export interface FailedReceipt {
  id: string;
  created_at: string;
  status: string;
  image_url: string;
}

export async function getReviewTransactions(
  page: number,
  pageSize: number,
): Promise<{ data: ReviewTransaction[]; count: number }> {
  const { data, error, count } = await supabase
    .from("transactions")
    .select("*, transaction_items(*), receipts(status)", { count: "exact" })
    .eq("is_reviewed", false)
    .order("created_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (error) throw error;
  return { data: (data ?? []) as ReviewTransaction[], count: count ?? 0 };
}

export async function retryReceipt(receiptId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('process-receipts', {
    body: { receipt_id: receiptId },
  });
  if (error) throw error;
}

export async function approveTransaction(params: {
  transactionId: string;
  receiptId: string | null;
  subtotal: number;
}): Promise<{ transactionUpdated: boolean }> {
  const [transactionResult, receiptResult] = await Promise.all([
    supabase
      .from('transactions')
      .update({ total_amount: params.subtotal, is_reviewed: true })
      .eq('id', params.transactionId)
      .select('id'),
    params.receiptId
      ? supabase
          .from('receipts')
          .update({ status: 'completed' })
          .eq('id', params.receiptId)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (transactionResult.error) throw transactionResult.error;
  if (receiptResult.error) throw receiptResult.error;
  return { transactionUpdated: (transactionResult.data?.length ?? 0) > 0 };
}

export async function getFailedReceipts(): Promise<FailedReceipt[]> {
  const { data, error } = await supabase
    .from("receipts")
    .select("id, created_at, status, image_url")
    .in("status", ["error", "pending"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FailedReceipt[];
}
