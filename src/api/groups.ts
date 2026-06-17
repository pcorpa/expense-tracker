import { supabase } from '../lib/supabase';
import type { Group } from '../types';

export async function getGroups(): Promise<Group[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(id, name, is_personal, created_at)');
  if (error) throw error;
  return (data ?? [])
    .map((m: any) => m.groups as Group)
    .filter(Boolean);
}

export async function getGroupRoles(): Promise<Record<string, 'admin' | 'member'>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', user.id);
  const map: Record<string, 'admin' | 'member'> = {};
  for (const row of data ?? []) map[row.group_id] = row.role;
  return map;
}

export async function createGroup(params: { name: string; userId: string }): Promise<Group> {
  const groupId = crypto.randomUUID();
  const { error: groupError } = await supabase
    .from('groups')
    .insert([{ id: groupId, name: params.name }]);
  if (groupError) throw groupError;

  const { error: memberError } = await supabase
    .from('group_members')
    .insert([{ group_id: groupId, user_id: params.userId, role: 'admin' }]);
  if (memberError) throw memberError;

  return { id: groupId, name: params.name, is_personal: false, created_at: new Date().toISOString() };
}

export async function inviteMember(params: {
  groupId: string;
  email: string;
  groupName: string;
  invitingUserEmail: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke('send-invitation', {
    body: {
      group_id: params.groupId,
      invited_email: params.email,
      group_name: params.groupName,
      inviting_user_email: params.invitingUserEmail,
    },
  });
  if (error) throw error;
}
