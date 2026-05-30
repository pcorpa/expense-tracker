import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

async function fetchPendingAuditCount(): Promise<number> {
  const { count, error } = await supabase
    .from("transaction_items")
    .select("id", { count: "exact", head: true })
    .in("mapping_status", ["needs_mapping_review", "new_product_candidate"]);
  if (error) return 0;
  return count ?? 0;
}

export function usePendingAuditCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-audit-count", user?.id],
    queryFn: fetchPendingAuditCount,
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
