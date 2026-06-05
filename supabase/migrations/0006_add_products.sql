create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  category text,
  created_at timestamptz not null default now(),
  unique(group_id, name)
);

create index if not exists products_group_id_idx on products(group_id);

alter table products enable row level security;

drop policy if exists products_select on products;
drop policy if exists products_insert on products;
drop policy if exists products_update on products;
drop policy if exists products_delete on products;

create policy products_select on products for select using (
  exists (
    select 1 from group_members gm where gm.group_id = products.group_id and gm.user_id = auth.uid()
  )
);
create policy products_insert on products for insert with check (
  exists (
    select 1 from group_members gm where gm.group_id = products.group_id and gm.user_id = auth.uid()
  )
);
create policy products_update on products for update using (
  exists (
    select 1 from group_members gm where gm.group_id = products.group_id and gm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from group_members gm where gm.group_id = products.group_id and gm.user_id = auth.uid()
  )
);
create policy products_delete on products for delete using (
  exists (
    select 1 from group_members gm where gm.group_id = products.group_id and gm.user_id = auth.uid()
  )
);

grant select, insert, update, delete on products to authenticated;
