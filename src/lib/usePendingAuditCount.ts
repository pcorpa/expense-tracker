import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { getPendingProductAuditCount } from "../api/products";

export function usePendingAuditCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-audit-count", user?.id],
    queryFn: getPendingProductAuditCount,
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
