import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { getPendingInvitationsCount } from "../api/invitations";

export function usePendingInvitationsCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-invitations-count", user?.id],
    queryFn: () => getPendingInvitationsCount(user!.email!),
    enabled: Boolean(user?.email),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
