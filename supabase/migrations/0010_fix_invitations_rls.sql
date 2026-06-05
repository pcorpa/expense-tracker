-- Fix invitations RLS: replace auth.users subquery with auth.email()
-- auth.users is not accessible to authenticated users; auth.email() reads from the JWT directly.

drop policy if exists invitations_select on invitations;
drop policy if exists invitations_update on invitations;

create policy invitations_select on invitations for select using (
  invited_email = auth.email()
  or invited_by = auth.uid()
);

create policy invitations_update on invitations for update using (
  invited_email = auth.email()
) with check (
  invited_email = auth.email()
  and status in ('pending', 'accepted', 'declined')
);
