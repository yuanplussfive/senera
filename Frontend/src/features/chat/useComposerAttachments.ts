import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { UploadAttachmentData } from "../../api/eventTypes";
import { getComposerAttachmentDraft, type PendingAttachment } from "../../api/composerAttachmentDraft";
import { enqueueComposerFileSelection } from "../../api/composerFileSelection";
import { isImageFilePreview } from "../../lib/filePreview";
import { errorMessage, generateId } from "../../lib/util";
import { useUploadPreviewRegistry } from "./UploadPreviewRegistry";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { toast } from "sonner";

export type { PendingAttachment } from "../../api/composerAttachmentDraft";

export interface ComposerAttachmentsOptions {
  draftKey?: string;
  uploadUrl: string;
  uploadCsrfToken?: string;
  interactionLocked: boolean;
}

export interface ComposerAttachments {
  restoring: boolean;
  retain: () => () => void;
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

/** React binds the shared draft controller to composer input events and preview ownership. */
export function useComposerAttachments(options: ComposerAttachmentsOptions): ComposerAttachments {
  const csrf = useRef(options.uploadCsrfToken);
  csrf.current = options.uploadCsrfToken;
  const attachmentDraft = useMemo(
    () =>
      getComposerAttachmentDraft({
        scope: "console",
        draftKey: options.draftKey,
        uploadUrl: options.uploadUrl,
        createId: generateId,
        headers: (): Record<string, string> => (csrf.current ? { "X-Senera-Csrf": csrf.current } : {}),
        describeError: errorMessage,
        interruptedMessage: () => frontendMessage("upload.aborted"),
        onStorageError: (operation, error) =>
          toast.error(
            frontendMessage(
              operation === "load" ? "chat.attachment.draftLoadFailed" : "chat.attachment.draftSaveFailed",
              { reason: errorMessage(error) },
            ),
          ),
      }),
    [options.draftKey, options.uploadUrl],
  );
  const pendingAttachments = useStore(attachmentDraft.store, (state) => state.pending);
  const restoring = useStore(attachmentDraft.store, (state) => state.restoring);
  useEffect(() => attachmentDraft.retain(), [attachmentDraft]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const previews = useUploadPreviewRegistry();
  const enqueueFiles = (files: File[]): void => {
    void attachmentDraft.enqueue(files);
  };

  const commitSentAttachments = (): void =>
    attachmentDraft.commit(pendingAttachments, (entry) => {
      if (!entry.previewUrl || !entry.attachment || !isImageFilePreview({ name: entry.fileName, mime: entry.mime }))
        return false;
      previews.register(entry.attachment.resourceUri, entry.previewUrl);
      return true;
    });
  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>): void => {
    void enqueueComposerFileSelection(event.target, attachmentDraft);
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (options.interactionLocked) return;
    const files = readClipboardFiles(event.clipboardData);
    if (!files.length) return;
    enqueueFiles(files);
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  };
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    if (options.interactionLocked) return;
    dragDepth.current++;
    setIsDraggingFiles(true);
  };
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = options.interactionLocked ? "none" : "copy";
  };
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setIsDraggingFiles(false);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingFiles(false);
    if (!options.interactionLocked) enqueueFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return {
    restoring,
    retain: attachmentDraft.retain,
    enqueueFiles,
    pendingAttachments,
    isDraggingFiles,
    uploading: pendingAttachments.some((entry) => entry.status === "uploading"),
    removeAttachment: (id) => attachmentDraft.remove(id),
    retryAttachment: (id) => attachmentDraft.retry(id),
    markPreviewUnavailable: (id) => attachmentDraft.markPreviewUnavailable(id),
    collectUploadedAttachments: () => attachmentDraft.collect(pendingAttachments),
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
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}
