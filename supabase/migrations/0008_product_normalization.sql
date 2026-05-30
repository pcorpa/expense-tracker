-- Product Normalization Pipeline
-- Adds fuzzy-matching pipeline columns to transaction_items and two atomic RPC functions.

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS mapping_status text
    CHECK (mapping_status IN ('auto_matched', 'needs_mapping_review', 'new_product_candidate')),
  ADD COLUMN IF NOT EXISTS suggested_product_id uuid
    REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transaction_items_mapping_status_idx
  ON transaction_items (mapping_status);

-- RPC: confirm an existing product suggestion (for needs_mapping_review items).
-- Atomically links all transaction_items with the same raw name to the confirmed product.
CREATE OR REPLACE FUNCTION confirm_product_match(
  p_raw_name  text,
  p_product_id uuid,
  p_group_id  uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE transaction_items ti
  SET
    product_id     = p_product_id,
    mapping_status = 'auto_matched',
    suggested_product_id = NULL
  FROM transactions t
  WHERE ti.transaction_id = t.id
    AND t.group_id = p_group_id
    AND lower(trim(ti.name)) = lower(trim(p_raw_name))
    AND ti.mapping_status IN ('needs_mapping_review', 'new_product_candidate');
END;
$$;

-- RPC: approve a new canonical product and link all matching raw items.
-- Inserts (or upserts) the product then bulk-updates every historical item with that raw name.
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

  INSERT INTO products (group_id, name, category)
  VALUES (p_group_id, p_canonical_name, p_category)
  ON CONFLICT (group_id, name) DO UPDATE SET category = EXCLUDED.category
  RETURNING id INTO v_product_id;

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
