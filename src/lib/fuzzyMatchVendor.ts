import Fuse, { type IFuseOptions } from "fuse.js";
import type { Vendor, VendorMappingStatus } from "../types";

export type VendorMatchResult = {
  similarity: number;
  status: VendorMappingStatus;
  suggestedVendorId: string | null;
  suggestedVendorName: string | null;
};

const FUSE_OPTIONS: IFuseOptions<Vendor> = {
  keys: ["canonical_name"],
  includeScore: true,
  threshold: 1.0,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

function extractTokens(name: string): Set<string> {
  return new Set(
    name.toLowerCase()
      .split(/[\s\W]+/)
      .filter((word) => word.length >= 5),
  );
}

function tokenOverlapMatch(rawName: string, vendors: Vendor[]): Vendor | null {
  const rawTokens = extractTokens(rawName);
  if (rawTokens.size === 0) return null;
  for (const vendor of vendors) {
    const canonicalTokens = extractTokens(vendor.canonical_name);
    for (const token of canonicalTokens) {
      if (rawTokens.has(token)) return vendor;
    }
  }
  return null;
}

export function buildVendorIndex(vendors: Vendor[]): Fuse<Vendor> {
  return new Fuse(vendors, FUSE_OPTIONS);
}

export function matchVendor(rawName: string, index: Fuse<Vendor>, vendors: Vendor[]): VendorMatchResult {
  const results = index.search(rawName, { limit: 1 });

  if (results.length > 0) {
    const best = results[0];
    const similarity = 1 - (best.score ?? 1);

    if (similarity > 0.9) {
      return { similarity, status: "auto_matched", suggestedVendorId: best.item.id, suggestedVendorName: best.item.canonical_name };
    }
    if (similarity >= 0.6) {
      return { similarity, status: "needs_vendor_review", suggestedVendorId: best.item.id, suggestedVendorName: best.item.canonical_name };
    }
  }

  const tokenMatch = tokenOverlapMatch(rawName, vendors);
  if (tokenMatch) {
    return {
      similarity: 0.5,
      status: "needs_vendor_review",
      suggestedVendorId: tokenMatch.id,
      suggestedVendorName: tokenMatch.canonical_name,
    };
  }

  return { similarity: 0, status: "new_vendor_candidate", suggestedVendorId: null, suggestedVendorName: null };
}

export function runVendorNormalizationPipeline(
  transactions: Array<{ id: string; vendor_or_source: string | null }>,
  vendors: Vendor[],
): Array<{ id: string } & VendorMatchResult> {
  const index = buildVendorIndex(vendors);
  return transactions.map((tx) => ({
    id: tx.id,
    ...matchVendor(tx.vendor_or_source ?? "", index, vendors),
  }));
}
