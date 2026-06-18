import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { getProfile, upsertProfile } from "../api/profiles";
import type { DateFormat } from "../types";

export function Profile() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD/MM/YYYY");
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (profileQuery.data && !initialized) {
      setFirstName(profileQuery.data.first_name || "");
      setLastName(profileQuery.data.last_name || "");
      setDateFormat(profileQuery.data.date_format ?? "DD/MM/YYYY");
      setInitialized(true);
    }
  }, [profileQuery.data, initialized]);

  const saveMutation = useMutation({
    mutationFn: upsertProfile,
    onSuccess: () => setMessage(t("profile.savedSuccess")),
    onError: (err: Error) => setMessage(err.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setMessage(null);
    saveMutation.mutate({
      id: user.id,
      email: user.email,
      first_name: firstName,
      last_name: lastName,
      date_format: dateFormat,
    });
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("profile.eyebrow")}</p>
          <h1>{t("profile.yourAccount")}</h1>
          <p>{t("profile.manageDesc")}</p>
        </div>
      </div>

      <div className="content-block profile-card">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            {t("profile.firstName")}
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder={t("profile.firstNamePlaceholder")}
            />
          </label>
          <label>
            {t("profile.lastName")}
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder={t("profile.lastNamePlaceholder")}
            />
          </label>
          <label>
            {t("profile.email")}
            <input value={profileQuery.data?.email || user?.email || ""} disabled />
          </label>
          <label>
            {t("profile.dateFormat")}
            <select
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as DateFormat)}
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY (Uruguay, Europe)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (United States)</option>
            </select>
          </label>

          {message ? <div className="alert">{message}</div> : null}

          <button type="submit" className="button" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t("profile.saving") : t("profile.saveBtn")}
          </button>
        </form>
      </div>
    </main>
  );
}

export default Profile;
