import { useCallback, useState } from "react";
import type { Attachment } from "../types";

/**
 * Attachment buffer for the composer. Reads files via FileReader and keeps
 * them in component state until the next sendChat() consumes and clears
 * them. Images are stored as base64 (so they survive into the multimodal
 * request body); text files are stored as their decoded content.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const processFile = useCallback((file: File): Promise<Attachment | null> => {
    const isImage = file.type.startsWith("image/");
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (isImage) {
          resolve({
            name: file.name,
            type: "image",
            data: result.split(",")[1],
            mimeType: file.type,
          });
        } else {
          resolve({
            name: file.name,
            type: "text",
            data: result,
            mimeType: file.type,
          });
        }
      };
      reader.onerror = () => resolve(null);
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const processed = await Promise.all(arr.map(processFile));
      setAttachments((prev) => [...prev, ...(processed.filter(Boolean) as Attachment[])]);
    },
    [processFile],
  );

  const removeAt = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  return { attachments, addFiles, removeAt, clear };
}
