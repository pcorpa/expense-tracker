import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { getGroups, createGroup, inviteMember } from "../api/groups";

export function GroupManager() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ["my-groups"],
    queryFn: getGroups,
    enabled: Boolean(user),
  });
  const groups = (groupsQuery.data ?? []).filter((g) => !g.is_personal);

  const createGroupMutation = useMutation({
    mutationFn: (groupName: string) => createGroup({ name: groupName, userId: user!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-groups"] });
      setName("");
      setStatus(t("groups.createSuccess"));
    },
    onError: (err: Error) => setStatus(err.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !name.trim()) return;
    setStatus(null);
    createGroupMutation.mutate(name.trim());
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !selectedGroupId || !inviteEmail.trim()) return;

    const selectedGroup = groups.find((g) => g.id === selectedGroupId);
    if (!selectedGroup) return;

    setInviteLoading(true);
    try {
      await inviteMember({
        groupId: selectedGroupId,
        email: inviteEmail.trim(),
        groupName: selectedGroup.name,
        invitingUserEmail: user.email!,
      });
      setStatus(t("groups.inviteSuccess"));
      setInviteEmail("");
      setSelectedGroupId(null);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInviteLoading(false);
    }
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
          <button type="submit" className="button" disabled={createGroupMutation.isPending}>
            {createGroupMutation.isPending ? t("groups.creating") : t("groups.createBtn")}
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

export default GroupManager;
