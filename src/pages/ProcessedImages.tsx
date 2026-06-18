import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { getReceipts, invokeProcessReceipts } from "../api/receipts";

export function ProcessedImages() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ["receipts", user?.id],
    queryFn: () => getReceipts(user!.id),
    enabled: Boolean(user),
  });

  async function handleProcessNow(receiptId: string) {
    setMessage(t("processedImages.processingNow"));
    try {
      await invokeProcessReceipts({ receiptId });
      setMessage(t("processedImages.processRequestSent"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
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
        {isLoading && <p>{t("processedImages.loading")}</p>}
        {!isLoading && !receipts.length && (
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
