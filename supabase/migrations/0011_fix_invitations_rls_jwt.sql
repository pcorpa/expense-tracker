-- Fix invitations RLS: use auth.jwt() ->> 'email' instead of auth.email()
-- auth.email() internally queries auth.users which is not accessible to authenticated role.
-- Reading from the JWT claims requires no table access.

drop policy if exists invitations_select on invitations;
drop policy if exists invitations_update on invitations;

create policy invitations_select on invitations for select using (
  invited_email = (auth.jwt() ->> 'email')
  or invited_by = auth.uid()
);

create policy invitations_update on invitations for update using (
  invited_email = (auth.jwt() ->> 'email')
) with check (
  invited_email = (auth.jwt() ->> 'email')
  and status in ('pending', 'accepted', 'declined')
);
