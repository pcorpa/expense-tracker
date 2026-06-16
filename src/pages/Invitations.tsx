import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      toast.success(accept ? t("invitations.joinedGroup", { name: invitation.groups.name }) : t("invitations.declinedMsg"));
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invitations-count"] });
    },
    onError: (err: any) => {
      toast.error(err.message || t("invitations.errorMsg"));
    },
  });

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem" }}>
        <Mail size={24} />
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{t("invitations.title")}</h1>
      </div>

      {isLoading && (
        <p style={{ color: "var(--text-muted, #888)" }}>{t("invitations.loading")}</p>
      )}

      {!isLoading && invitations.length === 0 && (
        <div style={{
          padding: "2rem",
          textAlign: "center",
          border: "1px dashed var(--border-strong)",
          borderRadius: 8,
          color: "var(--text-muted)",
        }}>
          {t("invitations.empty")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {invitations.map((inv) => (
          <div key={inv.id} style={{
            padding: "1.25rem 1.5rem",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "1rem" }}>
                {inv.groups?.name ?? t("invitations.unknownGroup")}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {t("invitations.invitedDate", { date: new Date(inv.created_at).toLocaleDateString() })}
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
                <Check size={15} /> {t("invitations.accept")}
              </button>
              <button
                onClick={() => respondMutation.mutate({ invitation: inv, accept: false })}
                disabled={respondMutation.isPending}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 6,
                  border: "1px solid var(--border-strong)", background: "transparent",
                  color: "var(--text-secondary)", cursor: "pointer",
                  fontWeight: 600, fontSize: "0.85rem",
                }}
              >
                <X size={15} /> {t("invitations.decline")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
