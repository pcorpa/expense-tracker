import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Group } from "../types";
import heic2any from "heic2any";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function UploadReceipt() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const convertHeicToJpeg = async (file: File): Promise<File> => {
    try {
      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });
      const blobToUse = Array.isArray(convertedBlob)
        ? convertedBlob[0]
        : (convertedBlob as Blob);
      return new File([blobToUse], file.name.replace(/\.heic$/i, ".jpg"), {
        type: "image/jpeg",
      });
    } catch (error) {
      console.error("HEIC conversion failed:", error);
      throw new Error(
        "Failed to convert HEIC image. Please try a different format."
      );
    }
  };

  const canvasConvertToJpeg = async (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas context"));
            return;
          }
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Failed to convert image"));
                return;
              }
              const newFile = new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, ".jpg"),
                { type: "image/jpeg" }
              );
              resolve(newFile);
            },
            "image/jpeg",
            0.9
          );
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  useEffect(() => {
    if (!user) return;

    supabase
      .from("group_members")
      .select("group_id(id,name)")
      .then(({ data, error }) => {
        if (error) {
          setStatus(error.message);
          return;
        }

        const loadedGroups = (data ?? []).map(
          (item: any) => item.group_id as Group,
        );
        setGroups(loadedGroups);
        if (loadedGroups.length > 0) {
          setGroupId(loadedGroups[0].id);
        }
      });
  }, [user]);

  const validateFile = (selectedFile: File | null): string | null => {
    if (!selectedFile) {
      return "Please select a file.";
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      return `File is too large. Maximum size: 10MB.`;
    }

    return null;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] ?? null;
    const error = validateFile(selectedFile);

    if (error) {
      setStatus(error);
      setFile(null);
      return;
    }

    if (!selectedFile) {
      setFile(null);
      setStatus(null);
      return;
    }

    setStatus("Converting image...");

    try {
      // If HEIC, convert using heic2any
      if (
        selectedFile.type === "image/heic" ||
        selectedFile.type === "image/heif" ||
        selectedFile.name.toLowerCase().endsWith(".heic") ||
        selectedFile.name.toLowerCase().endsWith(".heif")
      ) {
        const converted = await convertHeicToJpeg(selectedFile);
        setFile(converted);
        setStatus(null);
        return;
      }

      // If already a web-friendly format, use as is
      if (
        selectedFile.type === "image/jpeg" ||
        selectedFile.type === "image/png" ||
        selectedFile.type === "image/webp"
      ) {
        setFile(selectedFile);
        setStatus(null);
        return;
      }

      // For other formats, try canvas conversion to JPEG
      const converted = await canvasConvertToJpeg(selectedFile);
      setFile(converted);
      setStatus(null);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to process image";
      setStatus(errorMsg);
      setFile(null);
    }
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !user || !groupId) {
      setStatus("Choose an image and group first.");
      return;
    }

    const fileError = validateFile(file);
    if (fileError) {
      setStatus(fileError);
      return;
    }

    setLoading(true);
    setStatus(null);
    const storagePath = `${user.id}/${Date.now()}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(storagePath, file);
    if (uploadError) {
      setStatus(
        `Upload failed: ${uploadError.message}. Make sure the receipts storage bucket is configured in Supabase.`,
      );
      setLoading(false);
      return;
    }

    const { data: receiptRow, error: insertError } = await supabase
      .from("receipts")
      .insert({
        user_id: user.id,
        group_id: groupId,
        image_url: storagePath,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !receiptRow) {
      setStatus(insertError?.message ?? "Failed to create receipt record.");
      setLoading(false);
      return;
    }

    // Trigger AI processing
    setStatus("Sending to AI for analysis…");
    const { error: fnError } = await supabase.functions.invoke(
      "process-receipts",
      { body: { receipt_id: receiptRow.id } },
    );

    setLoading(false);

    if (fnError) {
      setStatus(
        `Receipt saved but AI processing failed: ${fnError.message}. You can retry from the Review Queue.`,
      );
      return;
    }

    setFile(null);
    navigate("/review");
  }

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">Receipt upload</p>
          <h1>Upload a receipt image</h1>
          <p>Store the image in Supabase storage and queue it for AI review.</p>
          <p style={{ fontSize: "0.9em", color: "#666", marginTop: "8px" }}>
            All image formats supported (HEIC, JPEG, PNG, WebP, etc.) - automatically
            converted to JPEG for compatibility (max 10MB).
          </p>
        </div>
      </div>

      <div className="content-block">
        {groups.length === 0 ? (
          <div className="alert">
            Create a group on the <strong>Groups</strong> page before uploading
            receipts.
          </div>
        ) : (
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Group
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="file-input-label">
              Receipt image
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
            </label>
            <button type="submit" className="button" disabled={loading}>
              {loading ? "Uploading…" : "Upload receipt"}
            </button>
          </form>
        )}

        {status ? <div className="alert">{status}</div> : null}
      </div>
    </main>
  );
}
