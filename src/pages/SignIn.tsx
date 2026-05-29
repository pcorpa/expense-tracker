import { useState, useEffect, type SyntheticEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export function SignIn() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      navigate("/", { replace: true });
    }
  }, [user, authLoading, navigate]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    navigate("/");
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) setMessage(error.message);
  }

  return (
    <main className="page page--centered">
      <div className="auth-card">
        <h1>Sign in</h1>
        <p>Use email/password or Google SSO to access your expense tracker.</p>
        <button
          type="button"
          className="button button--secondary"
          onClick={signInWithGoogle}
        >
          Continue with Google
        </button>
        <div className="separator">or</div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            />
          </label>

          {message ? <p className="form-message">{message}</p> : null}

          <button type="submit" className="button" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="small-text" style={{ marginTop: 16 }}>
          New here? <Link to="/signup">Create account</Link>
        </p>
      </div>
    </main>
  );
}
