import Fuse from "fuse.js";
import type { MappingStatus, Product } from "../types";

export type MatchResult = {
  similarity: number;
  status: MappingStatus;
  suggestedProductId: string | null;
  suggestedProductName: string | null;
};

const FUSE_OPTIONS: Fuse.IFuseOptions<Product> = {
  keys: ["name"],
  includeScore: true,
  threshold: 1.0, // disabled — we apply our own thresholds below
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function buildProductIndex(products: Product[]): Fuse<Product> {
  return new Fuse(products, FUSE_OPTIONS);
}

/** Fuse score is inverted (0 = perfect, 1 = no match) — convert to similarity 0–1. */
export function matchItem(rawName: string, index: Fuse<Product>): MatchResult {
  const results = index.search(rawName, { limit: 1 });
  if (results.length === 0) {
    return { similarity: 0, status: "new_product_candidate", suggestedProductId: null, suggestedProductName: null };
  }

  const best = results[0];
  const similarity = 1 - (best.score ?? 1);

  if (similarity > 0.9) {
    return { similarity, status: "auto_matched", suggestedProductId: best.item.id, suggestedProductName: best.item.name };
  }
  if (similarity >= 0.6) {
    return { similarity, status: "needs_mapping_review", suggestedProductId: best.item.id, suggestedProductName: best.item.name };
  }
  return { similarity, status: "new_product_candidate", suggestedProductId: null, suggestedProductName: null };
}

/**
 * Runs the full normalization pipeline over a list of raw items against
 * a single flat product catalog (no per-group splitting).
 */
export function runNormalizationPipeline(
  items: Array<{ id: string; name: string }>,
  products: Product[],
): Array<{ id: string } & MatchResult> {
  const index = buildProductIndex(products);
  return items.map((item) => ({ id: item.id, ...matchItem(item.name, index) }));
}
