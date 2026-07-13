import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Check, ChevronDown, Loader2, Paperclip, RotateCcw, Square, X } from "lucide-react";
import { toast } from "sonner";
import type {
  UploadAttachmentData,
  ModelProviderListItem,
} from "../../api/eventTypes";
import { uploadFile, type UploadProgress } from "../../api/uploadClient";
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
  IconButton,
  Tooltip,
} from "../../shared/ui";
import { FilePreviewIcon } from "./FilePreviewIcon";
import { PresetControl } from "./PresetPanel";
import { ModelProviderIcon } from "./ModelProviderIcon";
import {
  readChatModelProviders,
  readSelectedModelProvider,
} from "./modelProvider";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type {
  ChatModelConfig,
  ChatPresetConfig,
} from "./ChatPanelContracts";

const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const TOUCH_TEXTAREA_MAX_HEIGHT = 160;

export interface ChatComposerProps {
  disabled: boolean;
  running: boolean;
  modelConfig: ChatModelConfig;
  presetConfig: ChatPresetConfig;
  runtime: {
    socketStatus: string;
    uploadUrl: string;
  };
  onSend: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => void;
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
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;

  const hint = useMemo(() => {
    if (running) return prefersCompactControls ? "可补充指令" : "输入会注入当前任务，Alt+Enter 排到任务之后";
    if (runtime.socketStatus === "open") return "跟 senera 说点什么";
    if (runtime.socketStatus === "connecting" || runtime.socketStatus === "idle") return "正在连接后端…";
    return "后端未连接，请检查服务";
  }, [prefersCompactControls, runtime.socketStatus, running]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        taRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && running) {
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

  const submit = (queueMode?: MessageQueueMode): void => {
    const text = value.trim();
    const uploading = pendingAttachments.some((attachment) => attachment.status === "uploading");
    if (!text || disabled || uploading) return;
    const attachments = pendingAttachments.flatMap((entry) =>
      entry.status === "uploaded" && entry.attachment ? [entry.attachment] : []);
    onSend(text, attachments.length > 0 ? attachments : undefined, queueMode);
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
      setPendingAttachments((current) => [
        ...current,
        {
          id,
          fileName: file.name,
          mime: file.type,
          size: file.size,
          status: "uploading",
          progress: { loaded: 0, total: file.size, ratio: file.size === 0 ? 1 : 0 },
        },
      ]);
      void uploadFile(runtime.uploadUrl, file, {
        onProgress: (progress) => {
          setPendingAttachments((current) => current.map((entry) =>
            entry.id === id ? { ...entry, progress } : entry));
        },
      })
        .then((attachment) => {
          setPendingAttachments((current) => current.map((entry) =>
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
              : entry));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setPendingAttachments((current) => current.map((entry) =>
            entry.id === id ? { ...entry, status: "error", error: message } : entry));
          toast.error(frontendMessage("upload.fileFailed"), { description: message });
        });
    }
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
    if (disabled || running || !acceptsDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled || running || !acceptsDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
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
    if (disabled || running || !acceptsDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    enqueueFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <div className="border-t border-ink-200/60 bg-paper-50 px-3 pb-4 pt-3 sm:px-6 sm:pb-6">
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative mx-auto flex max-w-3xl flex-col gap-1.5 rounded-2xl border border-ink-200 bg-[var(--theme-chat-composer-bg)] px-3 py-2 shadow-bubble-ai transition",
          "focus-within:border-ink-300 focus-within:bg-[var(--theme-chat-composer-focus-bg)]",
          isDraggingFiles && "border-terra-300 bg-terra-50/70 ring-2 ring-terra-200/70",
        )}
      >
        {isDraggingFiles ? (
          <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-[14px] border border-dashed border-terra-300 bg-paper-50/80 text-[13px] font-medium text-terra-700 backdrop-blur-sm">
            {frontendMessage("runtime.migrated.features.chat.ChatComposer.247.13")}</div>
        ) : null}
        <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileSelection} />
        {pendingAttachments.length > 0 ? (
          <AttachmentTray
            attachments={pendingAttachments}
            onRemove={(id) => setPendingAttachments((current) => current.filter((entry) => entry.id !== id))}
          />
        ) : null}
        <div className="flex items-end gap-2">
          <IconButton
            label="attach"
            tooltip={frontendMessage("runtime.migrated.features.chat.ChatComposer.260.21")}
            tooltipSide="top"
            size="lg"
            tone="primary"
            disabled={disabled || running}
            onClick={() => fileInputRef.current?.click()}
            touchSafe
          >
            <Paperclip className="h-4 w-4" />
          </IconButton>
          <textarea
            ref={taRef}
            aria-label="输入消息"
            value={value}
            rows={1}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={hint}
            disabled={disabled}
            style={{ maxHeight: textareaMaxHeight }}
            className="scrollbar-thin min-w-0 flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:opacity-60"
          />
          {running ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Tooltip content="注入当前任务" side="top" shortcut={prefersCompactControls ? undefined : "↵"}>
                <MotionButton
                  onClick={() => submit("steer")}
                  disabled={!canSend}
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:pointer-events-none disabled:opacity-50",
                    prefersCompactControls && "min-h-11 min-w-11",
                    canSend ? "bg-ink-900 text-paper-50 hover:bg-terra-500" : "bg-ink-200/60 text-ink-400",
                  )}
                  aria-label="inject-current-run"
                >
                  <ArrowUp className="h-4 w-4" />
                </MotionButton>
              </Tooltip>
              <Tooltip content="中断当前运行" side="top" shortcut={prefersCompactControls ? undefined : "Esc"}>
                <MotionButton
                  onClick={onCancel}
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brick-500 text-paper-50 transition hover:bg-brick-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:pointer-events-none disabled:opacity-50",
                    prefersCompactControls && "min-h-11 min-w-11",
                  )}
                  aria-label="cancel"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </MotionButton>
              </Tooltip>
            </div>
          ) : (
            <Tooltip content="发送" side="top" shortcut={prefersCompactControls ? undefined : "↵"}>
              <MotionButton
                  onClick={() => submit(undefined)}
                disabled={!canSend}
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:pointer-events-none disabled:opacity-50",
                  prefersCompactControls && "min-h-11 min-w-11",
                  canSend ? "bg-ink-900 text-paper-50 hover:bg-terra-500" : "bg-ink-200/60 text-ink-400",
                )}
                aria-label="send"
              >
                <ArrowUp className="h-4 w-4" />
              </MotionButton>
            </Tooltip>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 px-1 font-mono text-[10.5px] text-ink-400">
          <span className="min-w-0 truncate">
            {prefersCompactControls ? null : running ? (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">↵</kbd>
                <span className="ml-1.5">{frontendMessage("runtime.migrated.features.chat.ChatComposer.334.42")}</span>
                <span className="mx-2 text-ink-300">·</span>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">Alt↵</kbd>
                <span className="ml-1.5">{frontendMessage("runtime.migrated.features.chat.ChatComposer.337.42")}</span>
                <span className="mx-2 text-ink-300">·</span>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">Esc</kbd>
                <span className="ml-1.5">{frontendMessage("runtime.migrated.features.chat.ChatComposer.340.42")}</span>
              </>
            ) : (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⌘K</kbd>
                <span className="ml-1.5">{frontendMessage("runtime.migrated.features.chat.ChatComposer.345.42")}</span>
                <span className="mx-2 text-ink-300">·</span>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⇧↵</kbd>
                <span className="ml-1.5">{frontendMessage("runtime.migrated.features.chat.ChatComposer.348.42")}</span>
              </>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1">
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
          </span>
        </div>
      </div>
    </div>
  );
}

function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5 px-0.5 pb-1">
      {attachments.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
            entry.status === "uploading" && "min-w-[210px]",
            entry.status === "error"
              ? "border-brick-200 bg-brick-50 text-brick-700"
              : "border-ink-200 bg-paper-50 text-ink-650",
          )}
        >
          <span className="relative shrink-0">
            <FilePreviewIcon name={entry.fileName} mime={entry.mime ?? entry.attachment?.mime} />
            {entry.status === "uploading" ? (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-paper-50 bg-paper-50">
                <Loader2 className="h-2.5 w-2.5 animate-spin text-terra-500" />
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
              <span className="shrink-0 font-mono text-[10px] text-ink-350">{formatFileSize(entry.size)}</span>
              {entry.status === "uploading" ? (
                <span className="shrink-0 font-mono text-[10px] text-terra-600">
                  {formatUploadProgress(entry.progress)}
                </span>
              ) : null}
            </span>
            {entry.status === "uploading" ? <UploadProgressBar progress={entry.progress} /> : null}
          </span>
          <IconButton
            label={frontendMessage("runtime.migrated.features.chat.ChatComposer.425.19")}
            tooltip={entry.error ?? "移除"}
            tooltipSide="top"
            size="sm"
            onClick={() => onRemove(entry.id)}
          >
            <X className="h-3 w-3" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function UploadProgressBar({ progress }: { progress?: UploadProgress }): JSX.Element {
  const ratio = readProgressRatio(progress);
  return (
    <span className="h-1 overflow-hidden rounded-full bg-ink-200/70">
      <span
        className={cn(
          "block h-full origin-left rounded-full bg-terra-500 transition-transform duration-150",
          ratio === undefined && "animate-pulse",
        )}
        style={{ transform: `scaleX(${ratio ?? 1})` }}
      />
    </span>
  );
}

function formatUploadProgress(progress?: UploadProgress): string {
  const ratio = readProgressRatio(progress);
  return ratio === undefined ? "上传中" : `${Math.round(ratio * 100)}%`;
}

function readProgressRatio(progress?: UploadProgress): number | undefined {
  const ratio = progress?.ratio ?? (
    progress?.total && progress.total > 0 ? progress.loaded / progress.total : undefined
  );
  return typeof ratio === "number" && Number.isFinite(ratio)
    ? Math.min(1, Math.max(0, ratio))
    : undefined;
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
  const chatModels = useMemo(
    () => readChatModelProviders(models),
    [models],
  );
  const selected = useMemo(
    () => readSelectedModelProvider(chatModels, selectedId) ?? null,
    [chatModels, selectedId],
  );
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
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            (disabled || chatModels.length === 0) && "pointer-events-none opacity-55",
          )}
          aria-label="选择模型"
        >
          <ModelProviderIcon
            className="shrink-0"
            icon={selected?.icon}
            size={14}
          />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-350" />
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
              icon={active
                ? <Check className="h-3.5 w-3.5 text-terra-500" />
                : (
                  <ModelProviderIcon
                    icon={model.icon}
                    size={14}
                  />
                )}
            >
              <span className="min-w-0 truncate text-[13px] text-ink-850">
                {readModelSelectorLabel(model)}
              </span>
            </DropdownMenuItem>
          );
        })}
        {!usesDefault && defaultModel && onUseDefault ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-ink-450">
              {frontendMessage("chat.model.defaultHint", { model: readModelSelectorLabel(defaultModel) })}
            </div>
            <DropdownMenuItem
              onSelect={onUseDefault}
              className="h-10 py-2"
              icon={<RotateCcw className="h-3.5 w-3.5 text-terra-500" />}
            >
              <span className="min-w-0 truncate text-[13px] text-ink-850">
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
