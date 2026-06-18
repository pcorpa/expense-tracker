import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CircleCheckBig, ScanLine, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { getAllGroups } from "../api/groups";
import {
  uploadReceiptFile,
  createReceiptRecord,
  invokeProcessReceipts,
  markReceiptError,
} from "../api/receipts";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const convertHeicToJpeg = async (file: File): Promise<File> => {
  const heic2any = (await import("heic2any")).default;
  const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blobToUse = Array.isArray(convertedBlob) ? convertedBlob[0] : (convertedBlob as Blob);
  return new File([blobToUse], file.name.replace(/\.heic$/i, ".jpg"), { type: "image/jpeg" });
};

const canvasConvertToJpeg = (file: File): Promise<File> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Failed to get canvas context")); return; }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Failed to convert image")); return; }
          resolve(new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", 0.9);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

export function UploadReceiptPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [groupId, setGroupId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const { data: allGroups = [] } = useQuery({
    queryKey: ["all-groups"],
    queryFn: getAllGroups,
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (allGroups.length > 0 && !groupId) setGroupId(allGroups[0].id);
  }, [allGroups]);

  const validateFile = (f: File | null): string | null => {
    if (!f) return t("upload.pleaseSelectFile");
    if (f.size > MAX_FILE_SIZE) return t("upload.fileTooLarge");
    return null;
  };

  const processFile = async (selected: File) => {
    const err = validateFile(selected);
    if (err) { setStatus(err); setIsError(true); setFile(null); return; }

    setStatus(t("uploadPanel.convertingImage"));
    setIsError(false);
    try {
      const isHeic =
        selected.type === "image/heic" ||
        selected.type === "image/heif" ||
        selected.name.toLowerCase().endsWith(".heic") ||
        selected.name.toLowerCase().endsWith(".heif");

      if (isHeic) {
        setFile(await convertHeicToJpeg(selected));
      } else if (["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
        setFile(selected);
      } else {
        setFile(await canvasConvertToJpeg(selected));
      }
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to process image");
      setIsError(true);
      setFile(null);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (!selected) { setFile(null); setStatus(null); return; }
    await processFile(selected);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) await processFile(dropped);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !user || !groupId) {
      setStatus(t("uploadPanel.selectFileFirst"));
      setIsError(true);
      return;
    }
    const fileErr = validateFile(file);
    if (fileErr) { setStatus(fileErr); setIsError(true); return; }

    setLoading(true);
    setStatus(null);
    setIsError(false);
    const storagePath = `${user.id}/${Date.now()}_${file.name}`;

    try {
      await uploadReceiptFile(storagePath, file);
    } catch (err) {
      setStatus(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsError(true);
      setLoading(false);
      return;
    }

    let receiptId: string;
    try {
      receiptId = await createReceiptRecord({ userId: user.id, groupId, storagePath });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to create receipt record.");
      setIsError(true);
      setLoading(false);
      return;
    }

    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    setStatus(t("uploadPanel.sendingToAi"));
    try {
      await invokeProcessReceipts({ receiptId, imageBase64, mimeType: file.type || "image/jpeg" });
    } catch (fnErr) {
      await markReceiptError(receiptId);
      setStatus(`AI processing failed: ${fnErr instanceof Error ? fnErr.message : String(fnErr)}`);
      setIsError(true);
      setLoading(false);
      return;
    }

    setLoading(false);
    setFile(null);
    navigate("/review");
  }

  const dropZoneClass = [
    "drop-zone",
    isDragging ? "drop-zone--dragging" : "",
    file ? "drop-zone--has-file" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="home-hub__panel" style={{ animationDelay: "0s" }}>
      <div className="panel-header">
        <ScanLine size={20} />
        <h2>{t("uploadPanel.title")}</h2>
      </div>

      {allGroups.length === 0 ? (
        <div className="alert">{t("uploadPanel.noGroupAlert")}</div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
          <div
            className={dropZoneClass}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileInputChange}
            />
            {file ? (
              <>
                <CircleCheckBig size={32} color="var(--color-success)" />
                <span style={{ fontSize: "0.85rem", color: "var(--color-success)", fontWeight: 500 }}>
                  {file.name}
                </span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{t("uploadPanel.clickToChange")}</span>
              </>
            ) : (
              <>
                <Upload size={32} color="var(--text-muted)" />
                <span style={{ fontSize: "0.88rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                  {t("uploadPanel.dropZoneLabel")}
                </span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  {t("uploadPanel.dropZoneSub")}
                </span>
              </>
            )}
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.83rem", color: "var(--text-secondary)", fontWeight: 500 }}>
            {t("uploadPanel.group")}
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>

          <button type="submit" className="button" disabled={loading || !file} style={{ marginTop: "auto" }}>
            {loading ? status ?? t("uploadPanel.uploading") : t("uploadPanel.uploadBtn")}
          </button>
        </form>
      )}

      {status && !loading && (
        <div className={isError ? "alert" : "alert"} style={isError ? undefined : { color: "var(--color-success)", background: "var(--color-success-subtle)", border: "1px solid rgba(52,211,153,0.2)" }}>
          {isError && <AlertCircle size={14} style={{ flexShrink: 0 }} />}
          {status}
        </div>
      )}
    </div>
  );
}
