import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

async function fetchPendingInvitationsCount(email: string): Promise<number> {
  const { count, error } = await supabase
    .from("invitations")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .eq("invited_email", email);
  if (error) return 0;
  return count ?? 0;
}

export function usePendingInvitationsCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-invitations-count", user?.id],
    queryFn: () => fetchPendingInvitationsCount(user!.email!),
    enabled: Boolean(user?.email),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
