import { supabase } from '../lib/supabase';

export interface Invitation {
  id: string;
  group_id: string;
  invited_email: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  groups: { name: string };
}

export async function getInvitations(email: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*, groups(name)')
    .eq('status', 'pending')
    .eq('invited_email', email)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Invitation[];
}

export async function respondToInvitation(params: {
  invitationId: string;
  groupId: string;
  userId: string;
  accept: boolean;
}): Promise<void> {
  if (params.accept) {
    const { error: memberError } = await supabase
      .from('group_members')
      .upsert(
        { group_id: params.groupId, user_id: params.userId, role: 'member' },
        { onConflict: 'group_id,user_id' },
      );
    if (memberError) throw memberError;
  }
  const { error } = await supabase
    .from('invitations')
    .update({
      status: params.accept ? 'accepted' : 'declined',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.invitationId);
  if (error) throw error;
}

export async function getPendingInvitationsCount(email: string): Promise<number> {
  const { count, error } = await supabase
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('invited_email', email);
  if (error) throw error;
  return count ?? 0;
}
