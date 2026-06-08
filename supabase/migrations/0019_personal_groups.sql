-- Add is_personal flag to groups
alter table groups add column is_personal boolean not null default false;

-- SECURITY DEFINER so the trigger can bypass RLS when inserting group + membership
create or replace function create_personal_group_for_new_user()
returns trigger language plpgsql security definer as $$
declare new_group_id uuid;
begin
  insert into groups (name, is_personal) values ('Personal', true) returning id into new_group_id;
  insert into group_members (group_id, user_id, role) values (new_group_id, new.id, 'admin');
  return new;
end;
$$;

-- Fire after each new profile row (SignUp.tsx inserts into profiles)
create trigger trg_create_personal_group
  after insert on profiles
  for each row execute function create_personal_group_for_new_user();

-- Prevent deleting personal groups (replaces the existing groups_delete policy)
drop policy if exists groups_delete on groups;
create policy groups_delete on groups for delete using (
  not is_personal and
  exists (
    select 1 from group_members gm
    where gm.group_id = groups.id and gm.user_id = auth.uid() and gm.role = 'admin'
  )
);

-- Prevent anyone from being added to a personal group (DB-level guard against invitation bypass)
create policy group_members_no_personal_insert on group_members for insert with check (
  not exists (
    select 1 from groups g where g.id = group_id and g.is_personal = true
  )
);

-- Backfill: create personal groups for existing users who don't already have one
do $$
declare u record; new_group_id uuid;
begin
  for u in
    select p.id from profiles p
    where not exists (
      select 1 from group_members gm
      join groups g on gm.group_id = g.id
      where gm.user_id = p.id and g.is_personal = true
    )
  loop
    insert into groups (name, is_personal) values ('Personal', true) returning id into new_group_id;
    insert into group_members (group_id, user_id, role) values (new_group_id, u.id, 'admin');
  end loop;
end;
$$;
