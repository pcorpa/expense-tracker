import { useNavigate } from "react-router-dom";
import { ArrowRight, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { UploadReceiptPanel } from "../components/UploadReceiptPanel";

export function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1>{t("home.title")}</h1>
          <p className="muted">{t("home.signedInAs")} <strong>{user?.email}</strong></p>
        </div>
      </div>

      <div className="home-hub">
        <UploadReceiptPanel />

        <div className="home-hub__panel home-hub__panel--action" style={{ animationDelay: "0.07s" }}>
          <div className="panel-header">
            <PenLine size={20} />
            <h2>{t("home.newTransaction")}</h2>
          </div>

          <div className="home-action-card">
            <p>{t("home.newTransactionDesc")}</p>

            <button
              className="button-primary home-entry-btn"
              onClick={() => navigate("/entry")}
            >
              {t("home.startEntry")}
              <ArrowRight size={16} className="home-entry-btn__arrow" />
            </button>
          </div>

          <p className="home-hub__hint">
            {t("home.newTransactionHint")} <span style={{ color: "var(--color-accent)" }}>/entry</span>.
          </p>
        </div>
      </div>
    </main>
  );
}
