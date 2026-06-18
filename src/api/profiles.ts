import { supabase } from '../lib/supabase';
import type { Profile, DateFormat } from '../types';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function upsertProfile(params: {
  id: string;
  email: string | undefined;
  first_name: string;
  last_name: string;
  date_format: DateFormat;
}): Promise<void> {
  const { error } = await supabase.from('profiles').upsert(params);
  if (error) throw error;
}
