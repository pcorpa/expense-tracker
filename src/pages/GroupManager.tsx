import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Group } from "../types";

export function GroupManager() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    if (!user) return;

    supabase
      .from("group_members")
      .select("group_id(id,name,is_personal),role")
      .then(({ data, error }) => {
        if (error) {
          setStatus(error.message);
          return;
        }

        const loadedGroups = (data ?? [])
          .map((item: any) => item.group_id as Group)
          .filter((g: Group) => !g.is_personal);
        setGroups(loadedGroups);
      });
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !name.trim()) return;

    setLoading(true);
    setStatus(null);

    const groupId = crypto.randomUUID();
    const { error: groupError } = await supabase.from("groups").insert([
      {
        id: groupId,
        name: name.trim(),
      },
    ]);

    if (groupError) {
      setLoading(false);
      setStatus(groupError.message);
      return;
    }

    const { error: memberError } = await supabase.from("group_members").insert([
      {
        group_id: groupId,
        user_id: user.id,
        role: "admin",
      },
    ]);

    if (memberError) {
      setLoading(false);
      setStatus(memberError.message);
      return;
    }

    setGroups((current) => [
      ...current,
      { id: groupId, name: name.trim(), is_personal: false, created_at: new Date().toISOString() },
    ]);
    setName("");
    setStatus(t("groups.createSuccess"));
    setLoading(false);
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !selectedGroupId || !inviteEmail.trim()) return;

    setInviteLoading(true);

    const selectedGroup = groups.find((g) => g.id === selectedGroupId);
    if (!selectedGroup) return;

    const { error } = await supabase.functions.invoke("send-invitation", {
      body: {
        group_id: selectedGroupId,
        invited_email: inviteEmail.trim(),
        group_name: selectedGroup.name,
        inviting_user_email: user.email,
      },
    });

    if (error) {
      console.error("Invitation error:", error);
      let detail = error.message;
      try {
        const body = await (error as any).context?.json?.();
        detail = JSON.stringify(body);
      } catch {}
      setStatus(`Failed: ${detail}`);
      setInviteLoading(false);
      return;
    }

    setStatus(t("groups.inviteSuccess"));
    setInviteEmail("");
    setSelectedGroupId(null);
    setInviteLoading(false);
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("groups.eyebrow")}</p>
          <h1>{t("groups.title")}</h1>
          <p>{t("groups.manageFamilyDesc")}</p>
        </div>
      </div>

      <div className="content-block">
        <h2>{t("groups.createGroup")}</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            {t("groups.groupName")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Family"
            />
          </label>
          <button type="submit" className="button" disabled={loading}>
            {loading ? t("groups.creating") : t("groups.createBtn")}
          </button>
        </form>

        {status ? <div className="alert">{status}</div> : null}
      </div>

      <div className="content-block" style={{ marginTop: "1rem" }}>
        <h2>{t("groups.yourGroups")}</h2>
        <div className="table-wrapper">
          {groups.length ? (
            groups.map((group) => (
              <article key={group.id} className="ticket-card">
                <div className="ticket-card__header">
                  <strong>{group.name}</strong>
                </div>
                {selectedGroupId === group.id && (
                  <div className="ticket-card__body">
                    <form className="form-grid" onSubmit={handleInvite}>
                      <label>
                        {t("groups.inviteByEmail")}
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(event) =>
                            setInviteEmail(event.target.value)
                          }
                          placeholder="user@example.com"
                          disabled={inviteLoading}
                        />
                      </label>
                      <button
                        type="submit"
                        className="button"
                        disabled={inviteLoading}
                      >
                        {inviteLoading ? t("groups.sending") : t("groups.sendInvite")}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setSelectedGroupId(null)}
                        disabled={inviteLoading}
                      >
                        {t("common.cancel")}
                      </button>
                    </form>
                  </div>
                )}
                {selectedGroupId !== group.id && (
                  <button
                    type="button"
                    className="button"
                    style={{ marginTop: 16 }}
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    {t("groups.inviteMember")}
                  </button>
                )}
              </article>
            ))
          ) : (
            <p>{t("groups.noGroups")}</p>
          )}
        </div>
      </div>
    </main>
  );
}
