-- Shared finance tracking schema for Supabase

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create type receipt_status as enum ('pending', 'processing', 'needs_review', 'completed', 'error');

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  image_url text not null,
  status receipt_status not null default 'pending',
  raw_ocr_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type transaction_type as enum ('income', 'expense');

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references receipts(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  type transaction_type not null,
  is_reviewed boolean not null default false,
  vendor_or_source text,
  date date,
  total_amount numeric,
  currency text default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references transactions(id) on delete cascade,
  name text not null,
  category text,
  price numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists group_members_user_id_idx on group_members(user_id);
create index if not exists receipts_group_id_idx on receipts(group_id);
create index if not exists transactions_group_id_idx on transactions(group_id);
create index if not exists transaction_items_transaction_id_idx on transaction_items(transaction_id);

-- Row Level Security policies

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table receipts enable row level security;
alter table transactions enable row level security;
alter table transaction_items enable row level security;

create policy profiles_select on profiles for select using (
  auth.uid() = id
);
create policy profiles_insert on profiles for insert with check (
  auth.uid() = id
);
create policy profiles_update on profiles for update using (
  auth.uid() = id
) with check (
  auth.uid() = id
);

create policy groups_select on groups for select using (
  exists (
    select 1 from group_members gm where gm.group_id = groups.id and gm.user_id = auth.uid()
  )
);
create policy groups_insert on groups for insert with check (
  true
);
create policy groups_update on groups for update using (
  exists (
    select 1 from group_members gm where gm.group_id = groups.id and gm.user_id = auth.uid() and gm.role = 'admin'
  )
) with check (
  exists (
    select 1 from group_members gm where gm.group_id = groups.id and gm.user_id = auth.uid() and gm.role = 'admin'
  )
);
create policy groups_delete on groups for delete using (
  exists (
    select 1 from group_members gm where gm.group_id = groups.id and gm.user_id = auth.uid() and gm.role = 'admin'
  )
);

create policy group_members_select on group_members for select using (
  user_id = auth.uid()
);
create policy group_members_insert on group_members for insert with check (
  user_id = auth.uid()
);
create policy group_members_update on group_members for update using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);
create policy group_members_delete on group_members for delete using (
  user_id = auth.uid()
);

create policy receipts_select on receipts for select using (
  exists (
    select 1 from group_members gm where gm.group_id = receipts.group_id and gm.user_id = auth.uid()
  )
);
create policy receipts_insert on receipts for insert with check (
  exists (
    select 1 from group_members gm where gm.group_id = receipts.group_id and gm.user_id = auth.uid()
  )
);
create policy receipts_update on receipts for update using (
  exists (
    select 1 from group_members gm where gm.group_id = receipts.group_id and gm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from group_members gm where gm.group_id = receipts.group_id and gm.user_id = auth.uid()
  )
);
create policy receipts_delete on receipts for delete using (
  exists (
    select 1 from group_members gm where gm.group_id = receipts.group_id and gm.user_id = auth.uid()
  )
);

create policy transactions_select on transactions for select using (
  exists (
    select 1 from group_members gm where gm.group_id = transactions.group_id and gm.user_id = auth.uid()
  )
);
create policy transactions_insert on transactions for insert with check (
  exists (
    select 1 from group_members gm where gm.group_id = transactions.group_id and gm.user_id = auth.uid()
  )
);
create policy transactions_update on transactions for update using (
  exists (
    select 1 from group_members gm where gm.group_id = transactions.group_id and gm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from group_members gm where gm.group_id = transactions.group_id and gm.user_id = auth.uid()
  )
);
create policy transactions_delete on transactions for delete using (
  exists (
    select 1 from group_members gm where gm.group_id = transactions.group_id and gm.user_id = auth.uid()
  )
);

create policy transaction_items_select on transaction_items for select using (
  exists (
    select 1 from transactions t where t.id = transaction_items.transaction_id and exists (
      select 1 from group_members gm where gm.group_id = t.group_id and gm.user_id = auth.uid()
    )
  )
);
create policy transaction_items_insert on transaction_items for insert with check (
  exists (
    select 1 from transactions t where t.id = transaction_items.transaction_id and exists (
      select 1 from group_members gm where gm.group_id = t.group_id and gm.user_id = auth.uid()
    )
  )
);
create policy transaction_items_update on transaction_items for update using (
  exists (
    select 1 from transactions t where t.id = transaction_items.transaction_id and exists (
      select 1 from group_members gm where gm.group_id = t.group_id and gm.user_id = auth.uid()
    )
  )
) with check (
  exists (
    select 1 from transactions t where t.id = transaction_items.transaction_id and exists (
      select 1 from group_members gm where gm.group_id = t.group_id and gm.user_id = auth.uid()
    )
  )
);
create policy transaction_items_delete on transaction_items for delete using (
  exists (
    select 1 from transactions t where t.id = transaction_items.transaction_id and exists (
      select 1 from group_members gm where gm.group_id = t.group_id and gm.user_id = auth.uid()
    )
  )
);
