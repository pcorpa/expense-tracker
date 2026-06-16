import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { DateFormat, Profile } from "../types";

export function Profile() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD/MM/YYYY");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setMessage(error.message);
          return;
        }
        if (!data) return;
        setProfile(data);
        setFirstName(data.first_name || "");
        setLastName(data.last_name || "");
        setDateFormat(data.date_format ?? "DD/MM/YYYY");
      });
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setLoading(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        date_format: dateFormat,
      });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(t("profile.savedSuccess"));
    setProfile((prev) =>
      prev ? { ...prev, first_name: firstName, last_name: lastName, date_format: dateFormat } : null,
    );
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
            <input value={profile?.email || user?.email || ""} disabled />
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

          <button type="submit" className="button" disabled={loading}>
            {loading ? t("profile.saving") : t("profile.saveBtn")}
          </button>
        </form>
      </div>
    </main>
  );
}
