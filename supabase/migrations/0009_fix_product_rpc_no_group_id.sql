-- Fix approve_product_mapping: products table has no group_id column.
-- Uses a manual find-or-create instead of ON CONFLICT (group_id, name).

CREATE OR REPLACE FUNCTION approve_product_mapping(
  p_raw_name       text,
  p_canonical_name text,
  p_category       text,
  p_group_id       uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Find existing product by name (case-insensitive)
  SELECT id INTO v_product_id
  FROM products
  WHERE lower(trim(name)) = lower(trim(p_canonical_name))
  LIMIT 1;

  IF v_product_id IS NULL THEN
    INSERT INTO products (name, category)
    VALUES (p_canonical_name, p_category)
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE products SET category = p_category WHERE id = v_product_id;
  END IF;

  -- Bulk-update all transaction_items with this raw name in the group
  UPDATE transaction_items ti
  SET
    product_id           = v_product_id,
    mapping_status       = 'auto_matched',
    suggested_product_id = NULL
  FROM transactions t
  WHERE ti.transaction_id = t.id
    AND t.group_id = p_group_id
    AND lower(trim(ti.name)) = lower(trim(p_raw_name))
    AND (ti.mapping_status IN ('needs_mapping_review', 'new_product_candidate')
         OR ti.mapping_status IS NULL);

  RETURN v_product_id;
END;
$$;
