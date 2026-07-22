import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Check, ChevronDown, Loader2, Paperclip, RotateCcw, Square, X } from "lucide-react";
import { toast } from "sonner";
import type { UploadAttachmentData, ModelProviderListItem } from "../../api/eventTypes";
import { uploadFile, type UploadProgress } from "../../api/uploadClient";
import { isImageFilePreview } from "../../lib/filePreview";
import { cn, generateId } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useResponsiveMode } from "../../shared/responsive";
import { MotionButton } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ConversationFrame,
  IconButton,
  Tooltip,
} from "../../shared/ui";
import { FilePreviewIcon } from "./FilePreviewIcon";
import { PresetControl } from "./PresetPanel";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { readChatModelProviders, readSelectedModelProvider } from "./modelProvider";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { ChatModelConfig, ChatPresetConfig } from "./ChatPanelContracts";
import { useUploadPreviewRegistry } from "./UploadPreviewRegistry";

const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const TOUCH_TEXTAREA_MAX_HEIGHT = 160;
const ACTIVE_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export interface ChatComposerProps {
  disabled: boolean;
  running: boolean;
  modelConfig: ChatModelConfig;
  presetConfig: ChatPresetConfig;
  runtime: {
    socketStatus: string;
    uploadUrl: string;
    uploadCsrfToken?: string;
  };
  onSend: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => boolean;
  onCancel: () => void;
}

type PendingAttachment = {
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
};

export function ChatComposer({
  disabled,
  running,
  modelConfig,
  presetConfig,
  runtime,
  onSend,
  onCancel,
}: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const ownedPreviewUrlsRef = useRef(new Set<string>());
  const uploadPreviewRegistry = useUploadPreviewRegistry();
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;
  const revokePreviewUrl = useCallback((previewUrl: string | undefined): void => {
    if (!previewUrl || !ownedPreviewUrlsRef.current.delete(previewUrl)) return;
    URL.revokeObjectURL(previewUrl);
  }, []);

  const hint = useMemo(() => {
    if (running) {
      return frontendMessage(prefersCompactControls ? "chat.composer.hintRunningCompact" : "chat.composer.hintRunning");
    }
    if (runtime.socketStatus === "open") return frontendMessage("chat.composer.hintOpen");
    if (runtime.socketStatus === "connecting" || runtime.socketStatus === "idle") {
      return frontendMessage("chat.composer.hintIdle");
    }
    return frontendMessage("chat.composer.hintDisconnected");
  }, [prefersCompactControls, runtime.socketStatus, running]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        taRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && running) {
        if (e.defaultPrevented || hasActiveInteractionLayer(e)) return;
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, onCancel]);

  useEffect(() => {
    if (!taRef.current) return;
    const el = taRef.current;
    el.style.height = "auto";
    el.style.height = value ? `${Math.min(el.scrollHeight, textareaMaxHeight)}px` : "auto";
  }, [textareaMaxHeight, value]);

  useEffect(
    () => () => {
      for (const previewUrl of ownedPreviewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      ownedPreviewUrlsRef.current.clear();
    },
    [],
  );

  const submit = (queueMode?: MessageQueueMode): void => {
    const text = value.trim();
    const uploading = pendingAttachments.some((attachment) => attachment.status === "uploading");
    if (!text || disabled || uploading) return;
    const attachments = pendingAttachments.flatMap((entry) =>
      entry.status === "uploaded" && entry.attachment ? [entry.attachment] : [],
    );
    const sent = onSend(text, attachments.length > 0 ? attachments : undefined, queueMode);
    if (sent === false) return;
    for (const entry of pendingAttachments) {
      if (entry.previewUrl && entry.status === "uploaded" && entry.attachment) {
        uploadPreviewRegistry.register(entry.attachment.uploadUri, entry.previewUrl);
        ownedPreviewUrlsRef.current.delete(entry.previewUrl);
      } else {
        revokePreviewUrl(entry.previewUrl);
      }
    }
    setValue("");
    setPendingAttachments([]);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(running && e.altKey ? "follow_up" : running ? "steer" : undefined);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, textareaMaxHeight)}px`;
  };

  const uploading = pendingAttachments.some((attachment) => attachment.status === "uploading");
  const canSend = !disabled && !uploading && value.trim().length > 0;

  const enqueueFiles = (files: File[]): void => {
    if (files.length === 0) return;
    for (const file of files) {
      const id = generateId();
      const previewUrl = isImageFilePreview({ name: file.name, mime: file.type })
        ? URL.createObjectURL(file)
        : undefined;
      if (previewUrl) ownedPreviewUrlsRef.current.add(previewUrl);
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
        },
      ]);
      void uploadFile(runtime.uploadUrl, file, {
        headers: runtime.uploadCsrfToken ? { "X-Senera-Csrf": runtime.uploadCsrfToken } : undefined,
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
          const message = error instanceof Error ? error.message : String(error);
          setPendingAttachments((current) =>
            current.map((entry) => (entry.id === id ? { ...entry, status: "error", error: message } : entry)),
          );
          toast.error(frontendMessage("upload.fileFailed"), { description: message });
        });
    }
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

  const acceptsDraggedFiles = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>): void => {
    enqueueFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (disabled || running) return;
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
    if (disabled || running) return;
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!acceptsDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled || running ? "none" : "copy";
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
    if (disabled || running) return;
    enqueueFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <div className="bg-transparent py-3 sm:py-4">
      <ConversationFrame mode="composer">
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative flex min-w-0 flex-col rounded-[18px] border border-line bg-surface-raised px-3.5 pb-2.5 pt-2.5 shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow] duration-150",
            isDraggingFiles && "border-accent-border bg-accent-surface ring-2 ring-accent-focus",
          )}
          data-chat-composer
        >
          {isDraggingFiles ? (
            <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-md border border-dashed border-accent-border bg-surface-panel text-[13px] font-medium text-accent-content">
              {frontendMessage("runtime.migrated.features.chat.ChatComposer.247.13")}
            </div>
          ) : null}
          <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileSelection} />
          {pendingAttachments.length > 0 ? (
            <AttachmentTray
              attachments={pendingAttachments}
              onRemove={removeAttachment}
              onPreviewUnavailable={markPreviewUnavailable}
            />
          ) : null}

          <textarea
            ref={taRef}
            aria-label={frontendMessage("chat.composer.inputMessage")}
            value={value}
            rows={1}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={hint}
            disabled={disabled}
            style={{ maxHeight: textareaMaxHeight }}
            className="scrollbar-thin min-h-10 w-full resize-none bg-transparent px-1 py-2 text-[14.5px] leading-6 text-content-primary placeholder:text-content-secondary focus:outline-none disabled:opacity-60 sm:min-h-10"
          />

          <div className="flex min-w-0 items-center gap-2 pt-0.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <IconButton
                label="attach"
                tooltip={frontendMessage("runtime.migrated.features.chat.ChatComposer.260.21")}
                tooltipSide="top"
                tone="muted"
                disabled={disabled || running}
                onClick={() => fileInputRef.current?.click()}
                touchSafe
              >
                <Paperclip className="h-4 w-4" />
              </IconButton>
              <PresetControl
                disabled={disabled || running}
                enabled={presetConfig.presetsEnabled}
                rootDir={presetConfig.presetRootDir}
                presets={presetConfig.presets}
                activePresetName={presetConfig.activePresetName}
                operations={presetConfig.presetOperations}
                onRefresh={presetConfig.onRefreshPresets}
                onSave={presetConfig.onSavePreset}
                onDelete={presetConfig.onDeletePreset}
                onSetActive={presetConfig.onSetActivePreset}
              />
              <ModelSelector
                disabled={disabled || running}
                models={modelConfig.modelProviders}
                selectedId={modelConfig.selectedModelProviderId}
                defaultModelId={modelConfig.defaultModelProviderId}
                onSelect={modelConfig.onSelectModelProvider}
                onUseDefault={modelConfig.onApplyDefaultModel}
                prefersCompactControls={prefersCompactControls}
              />
            </div>

            {running ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Tooltip
                  content={frontendMessage("chat.composer.inject")}
                  side="top"
                  shortcut={prefersCompactControls ? undefined : "↵"}
                >
                  <MotionButton
                    onClick={() => submit("steer")}
                    disabled={!canSend}
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-chat-composer-focus-bg)] disabled:pointer-events-none",
                      prefersCompactControls && "min-h-11 min-w-11",
                      canSend
                        ? "border-content-strong bg-content-strong text-content-inverse shadow-panel hover:border-accent-solid hover:bg-accent-solid hover:text-accent-on-solid active:bg-accent-solid-pressed"
                        : "border-line-subtle bg-surface-muted text-content-disabled",
                    )}
                    aria-label="inject-current-run"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </MotionButton>
                </Tooltip>
                <Tooltip
                  content={frontendMessage("chat.composer.cancelRunning")}
                  side="top"
                  shortcut={prefersCompactControls ? undefined : "Esc"}
                >
                  <MotionButton
                    onClick={onCancel}
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brick-200 bg-surface-raised text-brick-600 transition-colors duration-150 hover:bg-brick-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick-200",
                      prefersCompactControls && "min-h-11 min-w-11",
                    )}
                    aria-label="cancel"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </MotionButton>
                </Tooltip>
              </div>
            ) : (
              <Tooltip
                content={frontendMessage("chat.composer.send")}
                side="top"
                shortcut={prefersCompactControls ? undefined : "↵"}
              >
                <MotionButton
                  onClick={() => submit(undefined)}
                  disabled={!canSend}
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-chat-composer-focus-bg)] disabled:pointer-events-none",
                    prefersCompactControls && "min-h-11 min-w-11",
                    canSend
                      ? "border-content-strong bg-content-strong text-content-inverse shadow-panel hover:border-accent-solid hover:bg-accent-solid hover:text-accent-on-solid active:bg-accent-solid-pressed"
                      : "border-line-subtle bg-surface-muted text-content-disabled",
                  )}
                  aria-label="send"
                >
                  <ArrowUp className="h-4 w-4" />
                </MotionButton>
              </Tooltip>
            )}
          </div>
        </div>
      </ConversationFrame>
    </div>
  );
}

function hasActiveInteractionLayer(event: KeyboardEvent): boolean {
  if (event.composedPath().some((target) => target instanceof Element && target.matches(ACTIVE_LAYER_SELECTOR))) {
    return true;
  }
  return document.querySelector(ACTIVE_LAYER_SELECTOR) !== null;
}

function AttachmentTray({
  attachments,
  onRemove,
  onPreviewUnavailable,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onPreviewUnavailable: (id: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5 px-0.5 pb-1">
      {attachments.map((entry) =>
        entry.previewUrl ? (
          <div
            key={entry.id}
            className={cn(
              "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-surface-muted",
              entry.status === "error" ? "border-brick-300" : "border-line-subtle",
            )}
          >
            <img
              src={entry.previewUrl}
              alt={entry.fileName}
              title={entry.fileName}
              className="h-full w-full object-contain"
              onError={() => onPreviewUnavailable(entry.id)}
            />
            {entry.status === "uploading" ? (
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-ink-950/70 px-1 py-1">
                <UploadProgressBar progress={entry.progress} className="min-w-0 flex-1 bg-paper-50/25" />
                <span className="font-mono text-[9px] text-paper-50">{formatUploadProgress(entry.progress)}</span>
              </span>
            ) : null}
            {entry.status === "error" ? (
              <span className="absolute bottom-1 left-1 grid h-4 w-4 place-items-center rounded-full bg-brick-50">
                <AlertCircle className="h-3 w-3 text-brick-500" />
              </span>
            ) : null}
            <IconButton
              label={frontendMessage("chat.attachment.remove")}
              tooltip={entry.error ?? frontendMessage("chat.attachment.removeTooltip")}
              tooltipSide="top"
              size="sm"
              className="absolute right-0.5 top-0.5 bg-ink-950/70 text-paper-50 hover:bg-ink-900"
              onClick={() => onRemove(entry.id)}
            >
              <X className="h-3 w-3" />
            </IconButton>
          </div>
        ) : (
          <div
            key={entry.id}
            className={cn(
              "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
              entry.status === "uploading" && "min-w-[210px]",
              entry.status === "error"
                ? "border-brick-200 bg-brick-50 text-brick-700"
                : "border-line-subtle bg-surface-raised text-content-secondary",
            )}
          >
            <span className="relative shrink-0">
              <FilePreviewIcon name={entry.fileName} mime={entry.mime ?? entry.attachment?.mime} />
              {entry.status === "uploading" ? (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-surface-raised bg-surface-raised">
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-accent-content" />
                </span>
              ) : null}
              {entry.status === "error" ? (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-paper-50 bg-brick-50">
                  <AlertCircle className="h-2.5 w-2.5 text-brick-500" />
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate">{entry.fileName}</span>
                <span className="shrink-0 font-mono text-[10px] text-content-muted">{formatFileSize(entry.size)}</span>
                {entry.status === "uploading" ? (
                  <span className="shrink-0 font-mono text-[10px] text-accent-content">
                    {formatUploadProgress(entry.progress)}
                  </span>
                ) : null}
              </span>
              {entry.previewUnavailable ? (
                <span className="text-[10px] text-content-muted">
                  {frontendMessage("chat.attachment.previewUnavailable")}
                </span>
              ) : null}
              {entry.status === "uploading" ? <UploadProgressBar progress={entry.progress} /> : null}
            </span>
            <IconButton
              label={frontendMessage("chat.attachment.remove")}
              tooltip={entry.error ?? frontendMessage("chat.attachment.removeTooltip")}
              tooltipSide="top"
              size="sm"
              onClick={() => onRemove(entry.id)}
            >
              <X className="h-3 w-3" />
            </IconButton>
          </div>
        ),
      )}
    </div>
  );
}

function UploadProgressBar({ progress, className }: { progress?: UploadProgress; className?: string }): JSX.Element {
  const ratio = readProgressRatio(progress);
  return (
    <span className={cn("h-1 overflow-hidden rounded-full bg-surface-muted", className)}>
      <span
        className={cn(
          "block h-full origin-left rounded-full bg-accent-solid transition-transform duration-150",
          ratio === undefined && "animate-pulse",
        )}
        style={{ transform: `scaleX(${ratio ?? 1})` }}
      />
    </span>
  );
}

function formatUploadProgress(progress?: UploadProgress): string {
  const ratio = readProgressRatio(progress);
  return ratio === undefined ? frontendMessage("chat.composer.uploading") : `${Math.round(ratio * 100)}%`;
}

function readProgressRatio(progress?: UploadProgress): number | undefined {
  const ratio =
    progress?.ratio ?? (progress?.total && progress.total > 0 ? progress.loaded / progress.total : undefined);
  return typeof ratio === "number" && Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : undefined;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
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

function ModelSelector({
  disabled,
  models,
  selectedId,
  defaultModelId,
  onSelect,
  onUseDefault,
  prefersCompactControls,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  defaultModelId?: string | null;
  onSelect: (id: string) => void;
  onUseDefault?: () => void;
  prefersCompactControls: boolean;
}): JSX.Element {
  const chatModels = useMemo(() => readChatModelProviders(models), [models]);
  const selected = useMemo(() => readSelectedModelProvider(chatModels, selectedId) ?? null, [chatModels, selectedId]);
  const label = readModelSelectorLabel(selected);
  const defaultModel = useMemo(
    () => readSelectedModelProvider(chatModels, defaultModelId ?? null) ?? null,
    [chatModels, defaultModelId],
  );
  const usesDefault = Boolean(defaultModel && defaultModel.id === selected?.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || chatModels.length === 0}>
        <MotionButton
          className={cn(
            "inline-flex h-9 min-w-0 max-w-[180px] items-center gap-1.5 rounded-md px-2 text-[11px] sm:h-7 sm:max-w-[230px]",
            prefersCompactControls && "min-h-11 min-w-11",
            "text-content-secondary transition hover:bg-surface-hover hover:text-content-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            (disabled || chatModels.length === 0) && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("chat.composer.selectModel")}
        >
          <ModelProviderIcon className="shrink-0" icon={selected?.icon} size={14} />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-content-muted" />
        </MotionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[min(280px,calc(100vw-24px))]">
        <DropdownMenuLabel>{frontendMessage("chat.model.currentConversation")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {chatModels.map((model) => {
          const active = model.id === selected?.id;
          return (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => onSelect(model.id)}
              className="h-10 py-2"
              icon={
                active ? (
                  <Check className="h-3.5 w-3.5 text-accent-content" />
                ) : (
                  <ModelProviderIcon icon={model.icon} size={14} />
                )
              }
            >
              <span className="min-w-0 truncate text-[13px] text-content-primary">{readModelSelectorLabel(model)}</span>
            </DropdownMenuItem>
          );
        })}
        {!usesDefault && defaultModel && onUseDefault ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-content-muted">
              {frontendMessage("chat.model.defaultHint", { model: readModelSelectorLabel(defaultModel) })}
            </div>
            <DropdownMenuItem
              onSelect={onUseDefault}
              className="h-10 py-2"
              icon={<RotateCcw className="h-3.5 w-3.5 text-accent-content" />}
            >
              <span className="min-w-0 truncate text-[13px] text-content-primary">
                {frontendMessage("chat.model.useDefault")}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function readModelSelectorLabel(model: ModelProviderListItem | null | undefined): string {
  return model?.model.trim() || "...";
}
