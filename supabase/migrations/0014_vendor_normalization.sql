-- Vendor Normalization Pipeline
-- Mirrors the product normalization pattern from 0008.

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  canonical_name text not null,
  created_at timestamptz not null default now(),
  unique(group_id, canonical_name)
);

alter table transactions
  add column if not exists vendor_id uuid references vendors(id) on delete set null,
  add column if not exists vendor_mapping_status text
    check (vendor_mapping_status in ('auto_matched', 'needs_vendor_review', 'new_vendor_candidate'));

create index if not exists vendors_group_id_idx on vendors(group_id);
create index if not exists transactions_vendor_mapping_status_idx on transactions(vendor_mapping_status);

-- RLS
alter table vendors enable row level security;

create policy vendors_select on vendors for select using (
  exists (select 1 from group_members gm where gm.group_id = vendors.group_id and gm.user_id = auth.uid())
);
create policy vendors_insert on vendors for insert with check (
  exists (select 1 from group_members gm where gm.group_id = vendors.group_id and gm.user_id = auth.uid())
);
create policy vendors_update on vendors for update using (
  exists (select 1 from group_members gm where gm.group_id = vendors.group_id and gm.user_id = auth.uid())
) with check (
  exists (select 1 from group_members gm where gm.group_id = vendors.group_id and gm.user_id = auth.uid())
);
create policy vendors_delete on vendors for delete using (
  exists (select 1 from group_members gm where gm.group_id = vendors.group_id and gm.user_id = auth.uid())
);

grant select, insert, update, delete on vendors to authenticated;

-- RPC: confirm an existing vendor suggestion (needs_vendor_review → auto_matched).
-- Atomically links all transactions with the same raw vendor name to the confirmed vendor.
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
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'Access denied';
  end if;

  update transactions
  set vendor_id = p_vendor_id,
      vendor_mapping_status = 'auto_matched'
  where group_id = p_group_id
    and lower(trim(coalesce(vendor_or_source, ''))) = lower(trim(p_raw_name))
    and vendor_mapping_status in ('needs_vendor_review', 'new_vendor_candidate');
end;
$$;

-- RPC: approve a new canonical vendor and link all matching raw transactions.
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
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'Access denied';
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

  return v_vendor_id;
end;
$$;
