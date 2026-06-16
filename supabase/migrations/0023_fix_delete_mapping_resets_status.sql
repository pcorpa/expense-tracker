-- When a raw mapping is deleted, the previously auto-matched records must be
-- reset to NULL so the next scan re-surfaces them in the audit queue.
-- Previously the RPCs only deleted the mapping row without resetting the items.

create or replace function delete_product_raw_mapping(
  p_mapping_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
  v_raw_name text;
begin
  select group_id, raw_name into v_group_id, v_raw_name
  from product_raw_mappings where id = p_mapping_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage product mappings';
  end if;

  -- Reset all transaction_items matched via this raw name so they re-surface on next scan
  update transaction_items ti
  set
    product_id           = null,
    mapping_status       = null,
    suggested_product_id = null
  from transactions t
  where ti.transaction_id = t.id
    and t.group_id = v_group_id
    and lower(trim(ti.name)) = lower(trim(v_raw_name))
    and ti.mapping_status = 'auto_matched';

  delete from product_raw_mappings where id = p_mapping_id;
end;
$$;

create or replace function delete_vendor_raw_mapping(
  p_mapping_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
  v_raw_name text;
begin
  select group_id, raw_name into v_group_id, v_raw_name
  from vendor_raw_mappings where id = p_mapping_id;

  if not exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only group admins can manage vendor mappings';
  end if;

  -- Reset all transactions matched via this raw name so they re-surface on next scan
  update transactions
  set
    vendor_id             = null,
    vendor_mapping_status = null
  where group_id = v_group_id
    and lower(trim(vendor_or_source)) = lower(trim(v_raw_name))
    and vendor_mapping_status = 'auto_matched';

  delete from vendor_raw_mappings where id = p_mapping_id;
end;
$$;
