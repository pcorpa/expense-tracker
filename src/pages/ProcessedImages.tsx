import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Receipt } from "../types";

export function ProcessedImages() {
  const { user } = useAuth();
  const { t } = useTranslation();
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
    setMessage(t("processedImages.processingNow"));
    const { error } = await supabase.functions.invoke("process-receipts", {
      body: JSON.stringify({ receipt_id: receiptId }),
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(t("processedImages.processRequestSent"));
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("processedImages.eyebrow")}</p>
          <h1>{t("processedImages.title")}</h1>
          <p>{t("processedImages.subtitle")}</p>
        </div>
      </div>

      <div className="content-block">
        {message ? <div className="alert">{message}</div> : null}
        {loading && <p>{t("processedImages.loading")}</p>}
        {!loading && !receipts.length && (
          <p>{t("processedImages.empty")}</p>
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
                  {t("processedImages.processNow")}
                </button>
              </div>
              <p className="small-text">{t("processedImages.receiptPath", { path: receipt.image_url })}</p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
