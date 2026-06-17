import { useQuery } from "@tanstack/react-query";
import { getPendingVendorCount } from "../api/vendors";

export function usePendingVendorCount() {
  return useQuery({
    queryKey: ["pending-vendor-count"],
    queryFn: getPendingVendorCount,
    refetchInterval: 60_000,
  });
}
