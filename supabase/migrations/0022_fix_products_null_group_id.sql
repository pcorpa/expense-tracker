-- Migration 0009 inserted products without group_id (a bug), making them invisible
-- through RLS. Back-fill group_id by inferring it from transaction_items references.

UPDATE products p
SET group_id = (
  SELECT t.group_id
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
  WHERE ti.product_id = p.id
  LIMIT 1
)
WHERE p.group_id IS NULL;

-- Remove any remaining products with no group_id (orphaned — no transaction items point to them)
DELETE FROM products WHERE group_id IS NULL;
