-- Create invitations table for group membership invitations

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, invited_email)
);

create index if not exists invitations_group_id_idx on invitations(group_id);
create index if not exists invitations_invited_email_idx on invitations(invited_email);
create index if not exists invitations_invited_by_idx on invitations(invited_by);

-- RLS policies for invitations table
alter table invitations enable row level security;

-- Users can view invitations sent to their email
create policy invitations_select on invitations for select using (
  invited_email = (select email from auth.users where id = auth.uid())
  or invited_by = auth.uid()
);

-- Users can create invitations for groups they are admin/member of
create policy invitations_insert on invitations for insert with check (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_id and gm.user_id = auth.uid()
  )
  and invited_by = auth.uid()
);

-- Users can update their own invitation status
create policy invitations_update on invitations for update using (
  invited_email = (select email from auth.users where id = auth.uid())
) with check (
  invited_email = (select email from auth.users where id = auth.uid())
  and status in ('pending', 'accepted', 'declined')
);

grant select, insert, update on invitations to authenticated;
