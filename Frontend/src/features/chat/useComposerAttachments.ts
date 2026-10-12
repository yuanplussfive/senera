import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { UploadAttachmentData } from "../../api/eventTypes";
import { uploadFile, type UploadProgress } from "../../api/uploadClient";
import { isImageFilePreview } from "../../lib/filePreview";
import { errorMessage, generateId } from "../../lib/util";
import { useUploadPreviewRegistry } from "./UploadPreviewRegistry";

export type PendingAttachment = {
  id: string;
  fileName: string;
  mime?: string;
  size: number;
  status: "uploading" | "uploaded" | "error";
  progress?: UploadProgress;
  attachment?: UploadAttachmentData;
  error?: string;
  previewUrl?: string;
  previewUnavailable?: boolean;
  file?: File;
};

export interface ComposerAttachmentsOptions {
  draftKey?: string;
  uploadUrl: string;
  uploadCsrfToken?: string;
  /** Blocks paste and drag intake while the composer is disabled or a run is active. */
  interactionLocked: boolean;
}

export interface ComposerAttachments {
  enqueueFiles: (files: File[]) => void;
  pendingAttachments: PendingAttachment[];
  isDraggingFiles: boolean;
  uploading: boolean;
  removeAttachment: (id: string) => void;
  retryAttachment: (id: string) => void;
  markPreviewUnavailable: (id: string) => void;
  collectUploadedAttachments: () => UploadAttachmentData[];
  commitSentAttachments: () => void;
  handleFileSelection: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}

// Attachment uploads keep their ownership while the user views another workspace.
const drafts = new Map<string, ReturnType<typeof createAttachmentDraft>>();
function createAttachmentDraft() {
  return createStore<{ pending: PendingAttachment[] }>(() => ({ pending: [] }));
}

export function useComposerAttachments(options: ComposerAttachmentsOptions): ComposerAttachments {
  const { uploadUrl, uploadCsrfToken, interactionLocked } = options;
  const attachmentDraft = useMemo(() => {
    if (!options.draftKey) return createAttachmentDraft();
    let draft = drafts.get(options.draftKey);
    if (!draft) {
      draft = createAttachmentDraft();
      drafts.set(options.draftKey, draft);
    }
    return draft;
  }, [options.draftKey]);
  const pendingAttachments = useStore(attachmentDraft, (state) => state.pending);
  const setPendingAttachments = useCallback(
    (update: (current: PendingAttachment[]) => PendingAttachment[]): void => {
      attachmentDraft.setState((state) => ({ pending: update(state.pending) }));
    },
    [attachmentDraft],
  );
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const uploadPreviewRegistry = useUploadPreviewRegistry();

  const revokePreviewUrl = useCallback((previewUrl: string | undefined): void => {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
  }, []);
  useEffect(() => {
    if (options.draftKey) return;
    return () => {
      for (const entry of attachmentDraft.getState().pending) revokePreviewUrl(entry.previewUrl);
      attachmentDraft.setState({ pending: [] });
    };
  }, [attachmentDraft, options.draftKey, revokePreviewUrl]);

  const startUpload = useCallback(
    (id: string, file: File): void => {
      void uploadFile(uploadUrl, file, {
        headers: uploadCsrfToken ? { "X-Senera-Csrf": uploadCsrfToken } : undefined,
        onProgress: (progress) => {
          setPendingAttachments((current) =>
            current.map((entry) => (entry.id === id ? { ...entry, progress } : entry)),
          );
        },
      })
        .then((attachment) => {
          setPendingAttachments((current) =>
            current.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    fileName: attachment.name,
                    mime: attachment.mime,
                    size: attachment.size,
                    status: "uploaded",
                    progress: { loaded: attachment.size, total: attachment.size, ratio: 1 },
                    attachment,
                  }
                : entry,
            ),
          );
        })
        .catch((error) => {
          const message = errorMessage(error);
          setPendingAttachments((current) =>
            current.map((entry) => (entry.id === id ? { ...entry, status: "error", error: message } : entry)),
          );
        });
    },
    [uploadCsrfToken, uploadUrl, setPendingAttachments],
  );

  const enqueueFiles = (files: File[]): void => {
    if (files.length === 0) return;
    for (const file of files) {
      const id = generateId();
      const previewUrl = isImageFilePreview({ name: file.name, mime: file.type })
        ? URL.createObjectURL(file)
        : undefined;
      setPendingAttachments((current) => [
        ...current,
        {
          id,
          fileName: file.name,
          mime: file.type,
          size: file.size,
          status: "uploading",
          progress: { loaded: 0, total: file.size, ratio: file.size === 0 ? 1 : 0 },
          previewUrl,
          file,
        },
      ]);
      startUpload(id, file);
    }
  };

  const retryAttachment = (id: string): void => {
    const entry = pendingAttachments.find((candidate) => candidate.id === id);
    if (!entry?.file) return;
    const file = entry.file;
    setPendingAttachments((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              status: "uploading",
              error: undefined,
              progress: { loaded: 0, total: file.size, ratio: file.size === 0 ? 1 : 0 },
            }
          : candidate,
      ),
    );
    startUpload(id, file);
  };

  const removeAttachment = (id: string): void => {
    revokePreviewUrl(pendingAttachments.find((entry) => entry.id === id)?.previewUrl);
    setPendingAttachments((current) => current.filter((entry) => entry.id !== id));
  };

  const markPreviewUnavailable = (id: string): void => {
    revokePreviewUrl(pendingAttachments.find((entry) => entry.id === id)?.previewUrl);
    setPendingAttachments((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, previewUrl: undefined, previewUnavailable: true } : entry)),
    );
  };

  const collectUploadedAttachments = (): UploadAttachmentData[] =>
    pendingAttachments.flatMap((entry) => (entry.status === "uploaded" && entry.attachment ? [entry.attachment] : []));

  // After a successful send, uploaded previews are handed over to the registry so
  // the message list can keep rendering them; everything else is revoked.
  const commitSentAttachments = (): void => {
    for (const entry of pendingAttachments) {
      if (entry.previewUrl && entry.status === "uploaded" && entry.attachment) {
        uploadPreviewRegistry.register(entry.attachment.resourceUri, entry.previewUrl);
      } else {
        revokePreviewUrl(entry.previewUrl);
      }
    }
    setPendingAttachments(() => []);
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>): void => {
    enqueueFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (interactionLocked) return;
    const files = readClipboardFiles(event.clipboardData);
    if (files.length === 0) return;
    enqueueFiles(files);
    if (!event.clipboardData.getData("text/plain")) {
      event.preventDefault();
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    if (interactionLocked) return;
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = interactionLocked ? "none" : "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (interactionLocked) return;
    enqueueFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return {
    enqueueFiles,
    pendingAttachments,
    isDraggingFiles,
    uploading: pendingAttachments.some((attachment) => attachment.status === "uploading"),
    removeAttachment,
    retryAttachment,
    markPreviewUnavailable,
    collectUploadedAttachments,
    commitSentAttachments,
    handleFileSelection,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}

function acceptsDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function readClipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return files;

  return Array.from(data.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
