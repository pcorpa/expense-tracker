-- Persistent raw vendor name → canonical vendor mappings.
-- Once a user confirms a mapping, it is stored here so future scans
-- can auto-match the same raw name without going through the review queue.

create table if not exists vendor_raw_mappings (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  raw_name   text not null,
  vendor_id  uuid not null references vendors(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists vendor_raw_mappings_group_raw_idx on vendor_raw_mappings(group_id, lower(raw_name));
create index if not exists vendor_raw_mappings_group_id_idx on vendor_raw_mappings(group_id);

-- RLS
alter table vendor_raw_mappings enable row level security;

create policy vrm_select on vendor_raw_mappings for select using (
  exists (select 1 from group_members gm where gm.group_id = vendor_raw_mappings.group_id and gm.user_id = auth.uid())
);
create policy vrm_insert on vendor_raw_mappings for insert with check (
  exists (select 1 from group_members gm where gm.group_id = vendor_raw_mappings.group_id and gm.user_id = auth.uid() and gm.role = 'admin')
);
create policy vrm_delete on vendor_raw_mappings for delete using (
  exists (select 1 from group_members gm where gm.group_id = vendor_raw_mappings.group_id and gm.user_id = auth.uid() and gm.role = 'admin')
);

grant select, insert, delete on vendor_raw_mappings to authenticated;

-- Update approve_vendor_mapping to also persist the raw→canonical mapping
create or replace function approve_vendor_mapping(
  p_raw_name       text,
  p_canonical_name text,
  p_group_id       uuid
) returns uuid
language plpgsql
security definer
as $$
declare
  v_vendor_id uuid;
begin
  if not exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage vendors';
  end if;

  insert into vendors (group_id, canonical_name)
  values (p_group_id, p_canonical_name)
  on conflict (group_id, canonical_name) do update set canonical_name = excluded.canonical_name
  returning id into v_vendor_id;

  update transactions
  set vendor_id = v_vendor_id,
      vendor_mapping_status = 'auto_matched'
  where group_id = p_group_id
    and lower(trim(coalesce(vendor_or_source, ''))) = lower(trim(p_raw_name))
    and (vendor_mapping_status in ('needs_vendor_review', 'new_vendor_candidate')
         or vendor_mapping_status is null);

  -- Persist the confirmed mapping so future scans skip the review queue
  insert into vendor_raw_mappings (group_id, raw_name, vendor_id)
  values (p_group_id, trim(p_raw_name), v_vendor_id)
  on conflict (group_id, lower(raw_name)) do update set vendor_id = excluded.vendor_id;

  return v_vendor_id;
end;
$$;

-- Update confirm_vendor_match to also persist the raw→canonical mapping
create or replace function confirm_vendor_match(
  p_raw_name  text,
  p_vendor_id uuid,
  p_group_id  uuid
) returns void
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage vendors';
  end if;

  update transactions
  set vendor_id = p_vendor_id,
      vendor_mapping_status = 'auto_matched'
  where group_id = p_group_id
    and lower(trim(coalesce(vendor_or_source, ''))) = lower(trim(p_raw_name))
    and vendor_mapping_status in ('needs_vendor_review', 'new_vendor_candidate');

  -- Persist the confirmed mapping
  insert into vendor_raw_mappings (group_id, raw_name, vendor_id)
  values (p_group_id, trim(p_raw_name), p_vendor_id)
  on conflict (group_id, lower(raw_name)) do update set vendor_id = excluded.vendor_id;
end;
$$;

-- Update delete_vendor to also clean up raw mappings
create or replace function delete_vendor(
  p_vendor_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from vendors where id = p_vendor_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage vendors';
  end if;

  -- Reset affected transactions so they re-appear in next scan
  update transactions
  set vendor_id = null,
      vendor_mapping_status = null
  where vendor_id = p_vendor_id;

  -- Remove all raw mappings pointing to this vendor
  delete from vendor_raw_mappings where vendor_id = p_vendor_id;

  delete from vendors where id = p_vendor_id;
end;
$$;

-- RPC: delete a single raw mapping (admin only)
create or replace function delete_vendor_raw_mapping(
  p_mapping_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from vendor_raw_mappings where id = p_mapping_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage vendor mappings';
  end if;

  delete from vendor_raw_mappings where id = p_mapping_id;
end;
$$;

grant execute on function delete_vendor_raw_mapping(uuid) to authenticated;
