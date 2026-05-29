import { useState, useEffect, type SyntheticEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export function SignUp() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      navigate("/", { replace: true });
    }
  }, [user, authLoading, navigate]);

  async function signUpWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) setMessage(error.message);
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    // Create profile record
    if (data.user) {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        email: email,
        first_name: firstName,
        last_name: lastName,
      });

      if (profileError) {
        setMessage(profileError.message);
        return;
      }
    }

    navigate("/");
  }

  return (
    <main className="page page--centered">
      <div className="auth-card">
        <h1>Create account</h1>
        <p>Start tracking receipts, expenses, and AI-processed tickets.</p>
        <button
          type="button"
          className="button button--secondary"
          onClick={signUpWithGoogle}
        >
          Continue with Google
        </button>
        <div className="separator">or</div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label>
            First name
            <input
              type="text"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
            />
          </label>
          <label>
            Last name
            <input
              type="text"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </label>

          {message ? <p className="form-message">{message}</p> : null}

          <button type="submit" className="button" disabled={loading}>
            {loading ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="small-text" style={{ marginTop: 16 }}>
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
