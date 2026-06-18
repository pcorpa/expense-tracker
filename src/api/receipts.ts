import { supabase } from '../lib/supabase';
import type { Receipt } from '../types';

export async function getReceipts(userId: string): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Receipt[];
}

export async function uploadReceiptFile(storagePath: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from('receipts').upload(storagePath, file);
  if (error) throw error;
}

export async function createReceiptRecord(params: {
  userId: string;
  groupId: string;
  storagePath: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('receipts')
    .insert({
      user_id: params.userId,
      group_id: params.groupId,
      image_url: params.storagePath,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Failed to create receipt record');
  return data.id;
}

export async function invokeProcessReceipts(params: {
  receiptId: string;
  imageBase64?: string;
  mimeType?: string;
}): Promise<void> {
  const body: Record<string, string> = { receipt_id: params.receiptId };
  if (params.imageBase64) body.image_data = params.imageBase64;
  if (params.mimeType) body.mime_type = params.mimeType;
  const { error } = await supabase.functions.invoke('process-receipts', { body });
  if (error) throw error;
}

export async function markReceiptError(receiptId: string): Promise<void> {
  const { error } = await supabase
    .from('receipts')
    .update({ status: 'error' })
    .eq('id', receiptId);
  if (error) throw error;
}

export async function deleteReceipt(receiptId: string): Promise<void> {
  const { error } = await supabase.from('receipts').delete().eq('id', receiptId);
  if (error) throw error;
}
