-- Recurring expenses: subscriptions, installment plans, and periodic bills

create table if not exists recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  vendor_id uuid references vendors(id) on delete set null,
  vendor_name text,
  type text not null check (type in ('subscription', 'installment', 'periodic_bill')),
  category text not null,
  currency text not null default 'UY$',
  -- Per-period amount:
  --   subscriptions/periodic_bills: the recurring charge
  --   installments: total_purchase_amount / total_installments
  amount numeric not null check (amount > 0),
  -- Installment-only fields
  total_purchase_amount numeric check (total_purchase_amount > 0),
  total_installments integer check (total_installments >= 2),
  frequency text not null check (frequency in (
    'weekly', 'biweekly', 'monthly', 'bimonthly',
    'quarterly', 'every4months', 'every6months', 'annual'
  )),
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  last_generated_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists recurring_expenses_group_id_idx on recurring_expenses(group_id);
create index if not exists recurring_expenses_is_active_idx on recurring_expenses(is_active);

alter table recurring_expenses enable row level security;

create policy recurring_expenses_select on recurring_expenses
  for select using (
    exists (
      select 1 from group_members gm
      where gm.group_id = recurring_expenses.group_id
        and gm.user_id = auth.uid()
    )
  );

create policy recurring_expenses_insert on recurring_expenses
  for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from group_members gm
      where gm.group_id = recurring_expenses.group_id
        and gm.user_id = auth.uid()
    )
  );

create policy recurring_expenses_update on recurring_expenses
  for update using (
    exists (
      select 1 from group_members gm
      where gm.group_id = recurring_expenses.group_id
        and gm.user_id = auth.uid()
    )
  );

create policy recurring_expenses_delete on recurring_expenses
  for delete using (
    exists (
      select 1 from group_members gm
      where gm.group_id = recurring_expenses.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Extend transactions table
alter table transactions
  add column if not exists recurring_expense_id uuid references recurring_expenses(id) on delete set null,
  add column if not exists installment_number integer;

create index if not exists transactions_recurring_expense_id_idx on transactions(recurring_expense_id);
