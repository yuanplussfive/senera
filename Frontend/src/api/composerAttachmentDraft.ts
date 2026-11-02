import { createStore, type StoreApi } from "zustand/vanilla";
import { AttachmentUploadTask } from "./attachmentUploadTask";
import { messageDraftRepository } from "./messageDraftRepository";
import { buildResourceContentUrl, type UploadProgress } from "./resourceUpload";
import type { UploadAttachmentData } from "./uploadTypes";

export interface PendingAttachment {
  id: string;
  fileName: string;
  mime?: string;
  size: number;
  mediaType?: "image" | "file" | "record" | "video";
  status: "uploading" | "uploaded" | "error";
  progress?: UploadProgress;
  attachment?: UploadAttachmentData;
  error?: string;
  previewUrl?: string;
  previewUnavailable?: boolean;
  file?: File;
}

export interface AttachmentDraftOptions {
  scope: string;
  draftKey?: string;
  uploadUrl: string;
  createId: () => string;
  headers: () => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  describeError: (error: unknown) => string;
  interruptedMessage: () => string;
  onStorageError: (operation: "load" | "save", error: unknown) => void;
}

/** The console and channel composers own attachments independently of editable text. */
export class ComposerAttachmentDraft {
  readonly store: StoreApi<{ pending: PendingAttachment[]; restoring: boolean }>;
  readonly ready: Promise<void>;
  private readonly uploads = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly tasks = new Map<string, AttachmentUploadTask>();
  private consumers = 0;
  private writes = 0;
  private saved: Promise<boolean> = Promise.resolve(true);
  private disposed = false;

  constructor(
    private options: AttachmentDraftOptions,
    private readonly onRelease?: () => void,
  ) {
    this.store = createStore(() => ({ pending: [] as PendingAttachment[], restoring: Boolean(options.draftKey) }));
    this.ready = this.restore();
  }

  configure(options: AttachmentDraftOptions): void {
    this.options = options;
  }

  private get storageKey(): string | undefined {
    const { scope, uploadUrl, draftKey } = this.options;
    return draftKey ? JSON.stringify([scope, uploadUrl, draftKey, "attachments"]) : undefined;
  }

  private async restore(): Promise<void> {
    try {
      if (!this.storageKey) return;
      const pending = await messageDraftRepository.read<PendingAttachment[]>(this.storageKey);
      this.store.setState({
        pending: (pending ?? []).map((entry) => ({
          ...entry,
          previewUrl: entry.file
            ? URL.createObjectURL(entry.file)
            : entry.attachment
              ? buildResourceContentUrl(this.options.uploadUrl, entry.attachment.resourceUri)
              : undefined,
          status: entry.status === "uploading" && !entry.file ? "error" : entry.status,
          error: entry.status === "uploading" && !entry.file ? this.options.interruptedMessage() : entry.error,
        })),
      });
      // A restored File can restart its interrupted transfer without a manual retry.
      // Keep actual request failures explicit, and never re-upload acknowledged resources.
      for (const entry of this.store.getState().pending) {
        if (entry.status === "uploading" && entry.file) void this.upload(entry);
      }
    } catch (error) {
      this.options.onStorageError("load", error);
    } finally {
      this.store.setState({ restoring: false });
    }
  }

  retain = (): (() => void) => {
    this.consumers++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers--;
      if (!this.options.draftKey && !this.consumers) this.clear();
      queueMicrotask(() => this.releaseUnused());
    };
  };

  private releaseUnused(): void {
    if (this.disposed || this.consumers || this.uploads.size || this.writes || this.store.getState().restoring) return;
    this.disposed = true;
    for (const entry of this.store.getState().pending) this.revoke(entry.previewUrl);
    this.tasks.clear();
    this.onRelease?.();
  }

  private revoke(url?: string): void {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  private persist(): void {
    if (!this.storageKey) return;
    const entries = this.store
      .getState()
      .pending.map(({ previewUrl: _url, progress: _progress, ...entry }) =>
        entry.status === "uploaded" ? { ...entry, file: undefined } : entry,
      );
    this.writes++;
    this.saved = messageDraftRepository
      .write(this.storageKey, entries.length ? entries : undefined)
      .then(() => true)
      .catch((error) => {
        this.options.onStorageError("save", error);
        return false;
      })
      .finally(() => {
        this.writes--;
        this.releaseUnused();
      });
  }

  async flush(): Promise<void> {
    let saved: Promise<boolean>;
    do {
      saved = this.saved;
      if (!(await saved)) throw new Error("Attachment draft could not be saved.");
    } while (saved !== this.saved);
  }

  private update(id: string, update: (entry: PendingAttachment) => PendingAttachment, persist = true): void {
    if (!this.store.getState().pending.some((entry) => entry.id === id)) return;
    this.store.setState((state) => ({
      pending: state.pending.map((entry) => (entry.id === id ? update(entry) : entry)),
    }));
    if (persist) this.persist();
  }

  async enqueue(files: readonly File[], mediaType?: PendingAttachment["mediaType"]): Promise<void> {
    await this.ready;
    for (const file of files) {
      const entry: PendingAttachment = {
        id: this.options.createId(),
        file,
        fileName: file.name,
        mime: file.type,
        size: file.size,
        mediaType,
        status: "uploading",
        previewUrl: URL.createObjectURL(file),
      };
      this.store.setState((state) => ({ pending: [...state.pending, entry] }));
      this.persist();
      void this.upload(entry);
    }
  }

  async addUploaded(attachment: UploadAttachmentData, mediaType?: PendingAttachment["mediaType"]): Promise<void> {
    await this.ready;
    this.store.setState((state) => ({
      pending: [
        ...state.pending,
        {
          id: this.options.createId(),
          fileName: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          mediaType,
          status: "uploaded",
          attachment,
          previewUrl: buildResourceContentUrl(this.options.uploadUrl, attachment.resourceUri),
        },
      ],
    }));
    this.persist();
  }

  retry(id: string): void {
    const entry = this.store.getState().pending.find((item) => item.id === id);
    if (entry?.file) void this.upload(entry);
  }

  private upload(entry: PendingAttachment): Promise<void> {
    const running = this.uploads.get(entry.id);
    if (running) return running.promise;
    if (!entry.file) return Promise.resolve();
    const task = this.tasks.get(entry.id) ?? new AttachmentUploadTask(entry.file);
    this.tasks.set(entry.id, task);
    const controller = new AbortController();
    this.update(
      entry.id,
      (item) => ({
        ...item,
        status: "uploading",
        error: undefined,
        progress: { loaded: 0, total: entry.size, ratio: entry.size === 0 ? 1 : 0 },
      }),
      entry.status !== "uploading",
    );
    // Persist the selected File before its request starts. Reload recovery must
    // never depend on whether IndexedDB or the network happened to finish first.
    const persisted = this.saved;
    const promise = persisted
      .then((saved) => {
        if (!saved) throw new Error("Attachment draft could not be saved.");
        controller.signal.throwIfAborted();
        return this.options.headers();
      })
      .then((headers) =>
        task.upload(this.options.uploadUrl, {
          headers,
          signal: controller.signal,
          onProgress: (progress) => this.update(entry.id, (item) => ({ ...item, progress }), false),
        }),
      )
      .then((attachment) => {
        this.update(entry.id, (item) => ({
          ...item,
          status: "uploaded",
          attachment,
          fileName: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          progress: { loaded: attachment.size, total: attachment.size, ratio: 1 },
        }));
      })
      .catch((error) => {
        this.update(entry.id, (item) => ({ ...item, status: "error", error: this.options.describeError(error) }));
      })
      .finally(() => {
        this.uploads.delete(entry.id);
        this.releaseUnused();
      });
    this.uploads.set(entry.id, { controller, promise });
    return promise;
  }

  remove(id: string): void {
    this.uploads.get(id)?.controller.abort();
    this.tasks.delete(id);
    this.revoke(this.store.getState().pending.find((entry) => entry.id === id)?.previewUrl);
    this.store.setState((state) => ({ pending: state.pending.filter((entry) => entry.id !== id) }));
    this.persist();
  }

  markPreviewUnavailable(id: string): void {
    this.revoke(this.store.getState().pending.find((entry) => entry.id === id)?.previewUrl);
    this.update(id, (entry) => ({ ...entry, previewUrl: undefined, previewUnavailable: true }));
  }

  collect(snapshot = this.store.getState().pending): UploadAttachmentData[] {
    return snapshot.map((entry) => {
      if (entry.status !== "uploaded" || !entry.attachment)
        throw new Error(entry.error ?? this.options.interruptedMessage());
      return entry.attachment;
    });
  }

  /** Only acknowledged entries are removed; newer selections remain in their draft. */
  commit(snapshot = this.store.getState().pending, transferPreview?: (entry: PendingAttachment) => boolean): void {
    for (const entry of snapshot) {
      if (!transferPreview?.(entry)) this.revoke(entry.previewUrl);
      this.tasks.delete(entry.id);
    }
    const sent = new Set(snapshot.map((entry) => entry.id));
    this.store.setState((state) => ({ pending: state.pending.filter((entry) => !sent.has(entry.id)) }));
    this.persist();
  }

  clear(): void {
    for (const entry of this.store.getState().pending) {
      this.uploads.get(entry.id)?.controller.abort();
      this.tasks.delete(entry.id);
      this.revoke(entry.previewUrl);
    }
    this.store.setState({ pending: [] });
    this.persist();
  }
}

const drafts = new Map<string, ComposerAttachmentDraft>();

export function getComposerAttachmentDraft(options: AttachmentDraftOptions): ComposerAttachmentDraft {
  if (!options.draftKey) return new ComposerAttachmentDraft(options);
  const key = JSON.stringify([options.scope, options.uploadUrl, options.draftKey]);
  let draft = drafts.get(key);
  if (!draft) {
    draft = new ComposerAttachmentDraft(options, () => drafts.delete(key));
    drafts.set(key, draft);
  } else draft.configure(options);
  return draft;
}
