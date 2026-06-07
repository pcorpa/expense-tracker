import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export function usePendingVendorCount() {
  return useQuery({
    queryKey: ["pending-vendor-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .in("vendor_mapping_status", ["needs_vendor_review", "new_vendor_candidate"]);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
