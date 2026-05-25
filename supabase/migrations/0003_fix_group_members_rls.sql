-- Fix group_members RLS policy to allow authenticated users to create groups

drop policy if exists group_members_insert on group_members;

create policy group_members_insert on group_members for insert with check (
  auth.uid() is not null and user_id = auth.uid()
);
