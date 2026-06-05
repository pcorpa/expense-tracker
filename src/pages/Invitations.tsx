import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

interface Invitation {
  id: string;
  group_id: string;
  invited_email: string;
  status: string;
  created_at: string;
  groups: { name: string };
}

async function fetchInvitations(email: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select("*, groups(name)")
    .eq("status", "pending")
    .eq("invited_email", email)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function Invitations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["invitations", user?.id],
    queryFn: () => fetchInvitations(user!.email!),
    enabled: Boolean(user?.email),
  });

  const respondMutation = useMutation({
    mutationFn: async ({ invitation, accept }: { invitation: Invitation; accept: boolean }) => {
      if (accept) {
        const { error: memberError } = await supabase
          .from("group_members")
          .upsert({ group_id: invitation.group_id, user_id: user!.id, role: "member" }, { onConflict: "group_id,user_id" });
        if (memberError) throw memberError;
      }
      const { error } = await supabase
        .from("invitations")
        .update({ status: accept ? "accepted" : "declined", updated_at: new Date().toISOString() })
        .eq("id", invitation.id);
      if (error) throw error;
    },
    onSuccess: (_, { accept, invitation }) => {
      toast.success(accept ? `Joined "${invitation.groups.name}"` : "Invitation declined");
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invitations-count"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Something went wrong");
    },
  });

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
        <Mail size={24} />
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Invitations</h1>
      </div>

      {isLoading && (
        <p style={{ color: "var(--text-muted, #888)" }}>Loading…</p>
      )}

      {!isLoading && invitations.length === 0 && (
        <div style={{
          padding: "2rem",
          textAlign: "center",
          border: "1px dashed #333",
          borderRadius: 8,
          color: "var(--text-muted, #888)",
        }}>
          No pending invitations.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {invitations.map((inv) => (
          <div key={inv.id} style={{
            padding: "1.25rem 1.5rem",
            borderRadius: 8,
            border: "1px solid #2a2a2a",
            background: "var(--surface, #1a1a1a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "1rem" }}>
                {inv.groups?.name ?? "Unknown group"}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--text-muted, #888)" }}>
                Invited {new Date(inv.created_at).toLocaleDateString()}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => respondMutation.mutate({ invitation: inv, accept: true })}
                disabled={respondMutation.isPending}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 6, border: "none",
                  background: "#16a34a", color: "#fff", cursor: "pointer",
                  fontWeight: 600, fontSize: "0.85rem",
                }}
              >
                <Check size={15} /> Accept
              </button>
              <button
                onClick={() => respondMutation.mutate({ invitation: inv, accept: false })}
                disabled={respondMutation.isPending}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 6,
                  border: "1px solid #444", background: "transparent",
                  color: "#ccc", cursor: "pointer",
                  fontWeight: 600, fontSize: "0.85rem",
                }}
              >
                <X size={15} /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
