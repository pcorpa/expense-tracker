-- Restrict vendor write operations to group admins.
-- Adds rename and delete RPCs with cascade reset on transactions.

-- Replace write policies with admin-only versions
drop policy if exists vendors_insert on vendors;
drop policy if exists vendors_update on vendors;
drop policy if exists vendors_delete on vendors;

create policy vendors_insert on vendors for insert with check (
  exists (
    select 1 from group_members gm
    where gm.group_id = vendors.group_id
      and gm.user_id = auth.uid()
      and gm.role = 'admin'
  )
);

create policy vendors_update on vendors for update
  using (
    exists (
      select 1 from group_members gm
      where gm.group_id = vendors.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from group_members gm
      where gm.group_id = vendors.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

create policy vendors_delete on vendors for delete
  using (
    exists (
      select 1 from group_members gm
      where gm.group_id = vendors.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- Update approve_vendor_mapping to require admin role
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

  return v_vendor_id;
end;
$$;

-- Update confirm_vendor_match to require admin role
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
end;
$$;

-- RPC: rename a canonical vendor (admin only)
create or replace function rename_vendor(
  p_vendor_id      uuid,
  p_canonical_name text
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

  update vendors set canonical_name = p_canonical_name where id = p_vendor_id;
end;
$$;

-- RPC: delete a canonical vendor and reset its transactions (admin only)
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

  -- Reset transactions so they re-surface in the next scan
  update transactions
  set vendor_id = null,
      vendor_mapping_status = null
  where vendor_id = p_vendor_id;

  delete from vendors where id = p_vendor_id;
end;
$$;

grant execute on function rename_vendor(uuid, text) to authenticated;
grant execute on function delete_vendor(uuid) to authenticated;
