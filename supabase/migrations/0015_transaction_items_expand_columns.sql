-- Brings transaction_items in line with schema.sql.
-- The original 0001 migration only had a 'price' column.
-- Production had these columns added manually; this migration applies them to dev.

alter table transaction_items
  add column if not exists product_id uuid references products(id) on delete set null,
  add column if not exists quantity numeric not null default 1,
  add column if not exists unit_price numeric not null default 0,
  add column if not exists item_total numeric not null default 0;

-- Migrate existing 'price' values into 'unit_price' before dropping
update transaction_items set unit_price = price where price is not null;

alter table transaction_items drop column if exists price;
