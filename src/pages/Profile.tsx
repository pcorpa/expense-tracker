import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { DateFormat, Profile } from "../types";

export function Profile() {
  const { user } = useAuth();
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

    setMessage("Profile updated successfully.");
    setProfile((prev) =>
      prev ? { ...prev, first_name: firstName, last_name: lastName, date_format: dateFormat } : null,
    );
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>Your account</h1>
          <p>
            Manage your account and review the tracking status of your uploads.
          </p>
        </div>
      </div>

      <div className="content-block profile-card">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            First name
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Enter your first name"
            />
          </label>
          <label>
            Last name
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Enter your last name"
            />
          </label>
          <label>
            Email
            <input value={profile?.email || user?.email || ""} disabled />
          </label>
          <label>
            Date format
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
            {loading ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </main>
  );
}
