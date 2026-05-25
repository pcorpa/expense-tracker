import { useAuth } from "../lib/auth";

export function Home() {
  const { user } = useAuth();

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1>Manage your expenses</h1>
          <p>
            Upload receipts, track processed tickets, and review your spending
            with a clean mobile-first dashboard.
          </p>
        </div>
      </div>

      <section className="grid grid--cards">
        <article className="card">
          <h2>Pending receipts</h2>
          <p>
            Easily upload receipt images and process them into shared group
            transactions.
          </p>
        </article>
        <article className="card">
          <h2>Group budgeting</h2>
          <p>
            Manage spending together with group-based access and shared finance
            tracking.
          </p>
        </article>
        <article className="card">
          <h2>Secure accounts</h2>
          <p>
            Each user has their own Supabase-backed workspace with role-based
            access to groups.
          </p>
        </article>
        <article className="card">
          <h2>Manual entry</h2>
          <p>
            Record expenses or income without receipts and add them directly to
            a group.
          </p>
        </article>
      </section>

      <footer className="content-block">
        <p className="muted">
          Signed in as <strong>{user?.email}</strong>.
        </p>
      </footer>
    </main>
  );
}
