-- Product Admin Controls + Persistent Raw Mappings
-- Mirrors 0016_vendor_admin_controls.sql + 0018_vendor_raw_mappings.sql for the product catalog.
-- Adds rename/delete RPCs, a product_raw_mappings table, and updates confirm/approve to persist mappings.

-- ── product_raw_mappings table ──────────────────────────────────────────────

create table if not exists product_raw_mappings (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  raw_name   text not null,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists prm_group_raw_idx on product_raw_mappings(group_id, lower(raw_name));
create index  if not exists prm_group_id_idx  on product_raw_mappings(group_id);

alter table product_raw_mappings enable row level security;

create policy prm_select on product_raw_mappings for select using (
  exists (select 1 from group_members gm where gm.group_id = product_raw_mappings.group_id and gm.user_id = auth.uid())
);
create policy prm_insert on product_raw_mappings for insert with check (
  exists (select 1 from group_members gm where gm.group_id = product_raw_mappings.group_id and gm.user_id = auth.uid() and gm.role = 'admin')
);
create policy prm_delete on product_raw_mappings for delete using (
  exists (select 1 from group_members gm where gm.group_id = product_raw_mappings.group_id and gm.user_id = auth.uid() and gm.role = 'admin')
);

grant select, insert, delete on product_raw_mappings to authenticated;

-- ── Update confirm_product_match: require admin + persist mapping ────────────

create or replace function confirm_product_match(
  p_raw_name   text,
  p_product_id uuid,
  p_group_id   uuid
) returns void
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage products';
  end if;

  update transaction_items ti
  set
    product_id           = p_product_id,
    mapping_status       = 'auto_matched',
    suggested_product_id = null
  from transactions t
  where ti.transaction_id = t.id
    and t.group_id = p_group_id
    and lower(trim(ti.name)) = lower(trim(p_raw_name))
    and ti.mapping_status in ('needs_mapping_review', 'new_product_candidate');

  insert into product_raw_mappings (group_id, raw_name, product_id)
  values (p_group_id, trim(p_raw_name), p_product_id)
  on conflict (group_id, lower(raw_name)) do update set product_id = excluded.product_id;
end;
$$;

-- ── Update approve_product_mapping: require admin + persist mapping ──────────

create or replace function approve_product_mapping(
  p_raw_name       text,
  p_canonical_name text,
  p_category       text,
  p_group_id       uuid
) returns uuid
language plpgsql
security definer
as $$
declare
  v_product_id uuid;
begin
  if not exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage products';
  end if;

  insert into products (group_id, name, category)
  values (p_group_id, p_canonical_name, p_category)
  on conflict (group_id, name) do update set category = excluded.category
  returning id into v_product_id;

  update transaction_items ti
  set
    product_id           = v_product_id,
    mapping_status       = 'auto_matched',
    suggested_product_id = null
  from transactions t
  where ti.transaction_id = t.id
    and t.group_id = p_group_id
    and lower(trim(ti.name)) = lower(trim(p_raw_name))
    and (ti.mapping_status in ('needs_mapping_review', 'new_product_candidate')
         or ti.mapping_status is null);

  insert into product_raw_mappings (group_id, raw_name, product_id)
  values (p_group_id, trim(p_raw_name), v_product_id)
  on conflict (group_id, lower(raw_name)) do update set product_id = excluded.product_id;

  return v_product_id;
end;
$$;

-- ── RPC: rename a canonical product (admin only) ─────────────────────────────

create or replace function rename_product(
  p_product_id     uuid,
  p_canonical_name text,
  p_category       text
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from products where id = p_product_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage products';
  end if;

  update products
  set name = p_canonical_name, category = p_category
  where id = p_product_id;
end;
$$;

-- ── RPC: delete a canonical product and reset its items (admin only) ─────────

create or replace function delete_product(
  p_product_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from products where id = p_product_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage products';
  end if;

  -- Reset items so they re-surface in the next scan
  update transaction_items
  set product_id     = null,
      mapping_status = null,
      suggested_product_id = null
  where product_id = p_product_id;

  -- Remove raw mappings pointing to this product
  delete from product_raw_mappings where product_id = p_product_id;

  delete from products where id = p_product_id;
end;
$$;

-- ── RPC: delete a single raw mapping (admin only) ────────────────────────────

create or replace function delete_product_raw_mapping(
  p_mapping_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from product_raw_mappings where id = p_mapping_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage product mappings';
  end if;

  delete from product_raw_mappings where id = p_mapping_id;
end;
$$;

grant execute on function rename_product(uuid, text, text)  to authenticated;
grant execute on function delete_product(uuid)              to authenticated;
grant execute on function delete_product_raw_mapping(uuid)  to authenticated;
