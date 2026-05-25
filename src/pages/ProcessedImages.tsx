import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Receipt } from "../types";

export function ProcessedImages() {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    supabase
      .from("receipts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          setMessage(error.message);
          return;
        }
        setReceipts(data ?? []);
      });
  }, [user]);

  async function handleProcessNow(receiptId: string) {
    setMessage("Processing receipt now...");
    const { error } = await supabase.functions.invoke("process-receipts", {
      body: JSON.stringify({ receipt_id: receiptId }),
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Process request sent. Refresh after the function completes.");
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">Uploaded receipts</p>
          <h1>Pending and processed receipts</h1>
          <p>Review uploads and manually trigger AI processing if needed.</p>
        </div>
      </div>

      <div className="content-block">
        {message ? <div className="alert">{message}</div> : null}
        {loading && <p>Loading receipts…</p>}
        {!loading && !receipts.length && (
          <p>No uploaded receipts available yet.</p>
        )}

        <div className="ticket-list">
          {receipts.map((receipt) => (
            <article key={receipt.id} className="ticket-card">
              <div className="ticket-card__header">
                <div>
                  <strong>{receipt.image_url.split("/").pop()}</strong>
                  <span>{receipt.status.toUpperCase()}</span>
                </div>
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => handleProcessNow(receipt.id)}
                >
                  Process now
                </button>
              </div>
              <p className="small-text">Receipt path: {receipt.image_url}</p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
