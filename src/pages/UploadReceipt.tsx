import { useTranslation } from "react-i18next";
import { UploadReceiptPanel } from "../components/UploadReceiptPanel";

export function UploadReceipt() {
  const { t } = useTranslation();

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">{t("upload.eyebrow")}</p>
          <h1>{t("upload.title")}</h1>
          <p>{t("upload.subtitle")}</p>
        </div>
      </div>
      <div className="content-block" style={{ padding: 0, background: "none", border: "none" }}>
        <UploadReceiptPanel />
      </div>
    </main>
  );
}

export default UploadReceipt;
