import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Check, ChevronDown, Loader2, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import type {
  ModelProviderListItem,
  PluginConfigItem,
  PluginConfigMutationState,
  UploadAttachmentData,
} from "../../api/eventTypes";
import { uploadFile, type UploadProgress } from "../../api/uploadClient";
import { cn, generateId } from "../../lib/util";
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
import { PluginConfigControl } from "./PluginConfigPanel";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { readSelectedModelProvider } from "./modelProvider";

const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const TOUCH_TEXTAREA_MAX_HEIGHT = 160;

interface ChatComposerProps {
  disabled: boolean;
  running: boolean;
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  onSelectModelProvider: (id: string) => void;
  pluginConfigs: PluginConfigItem[];
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  onRefreshPluginConfigs: () => void;
  onSavePluginConfig: (pluginName: string, toml: string) => string | null;
  onSetPluginEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
  socketStatus: string;
  uploadUrl: string;
  onSend: (input: string, attachments?: UploadAttachmentData[]) => void;
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
  modelProviders,
  selectedModelProviderId,
  onSelectModelProvider,
  pluginConfigs,
  pluginConfigOperations,
  onRefreshPluginConfigs,
  onSavePluginConfig,
  onSetPluginEnabled,
  socketStatus,
  uploadUrl,
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
    if (running) return prefersCompactControls ? "正在思考" : "正在思考——可按 Esc 中断";
    if (socketStatus === "open") return "跟 senera 说点什么";
    if (socketStatus === "connecting" || socketStatus === "idle") return "正在连接后端…";
    return "后端未连接，请检查服务";
  }, [prefersCompactControls, socketStatus, running]);

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

  const submit = (): void => {
    const text = value.trim();
    const uploading = pendingAttachments.some((attachment) => attachment.status === "uploading");
    if (!text || disabled || running || uploading) return;
    const attachments = pendingAttachments.flatMap((entry) =>
      entry.status === "uploaded" && entry.attachment ? [entry.attachment] : []);
    onSend(text, attachments.length > 0 ? attachments : undefined);
    setValue("");
    setPendingAttachments([]);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, textareaMaxHeight)}px`;
  };

  const uploading = pendingAttachments.some((attachment) => attachment.status === "uploading");
  const canSend = !disabled && !running && !uploading && value.trim().length > 0;

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
      void uploadFile(uploadUrl, file, {
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
          toast.error("文件上传失败", { description: message });
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
          "relative mx-auto flex max-w-3xl flex-col gap-1.5 rounded-2xl border border-ink-200 bg-paper-100/80 px-3 py-2 shadow-bubble-ai transition",
          "focus-within:border-ink-300 focus-within:bg-paper-50",
          isDraggingFiles && "border-terra-300 bg-terra-50/70 ring-2 ring-terra-200/70",
        )}
      >
        {isDraggingFiles ? (
          <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-[14px] border border-dashed border-terra-300 bg-paper-50/80 text-[13px] font-medium text-terra-700 backdrop-blur-sm">
            松开上传文件
          </div>
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
            tooltip="附加文件"
            tooltipSide="top"
            size="lg"
            tone="primary"
            disabled={running}
            onClick={() => fileInputRef.current?.click()}
            touchSafe
          >
            <Paperclip className="h-4 w-4" />
          </IconButton>
          <textarea
            ref={taRef}
            value={value}
            rows={1}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={hint}
            disabled={running}
            style={{ maxHeight: textareaMaxHeight }}
            className="scrollbar-thin min-w-0 flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
          />
          {running ? (
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
          ) : (
            <Tooltip content="发送" side="top" shortcut={prefersCompactControls ? undefined : "↵"}>
              <MotionButton
                onClick={submit}
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
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">Esc</kbd>
                <span className="ml-1.5">中断当前运行</span>
              </>
            ) : (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⌘K</kbd>
                <span className="ml-1.5">聚焦输入</span>
                <span className="mx-2 text-ink-300">·</span>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⇧↵</kbd>
                <span className="ml-1.5">换行</span>
              </>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <PluginConfigControl
              disabled={disabled || running}
              plugins={pluginConfigs}
              operations={pluginConfigOperations}
              onRefresh={onRefreshPluginConfigs}
              onSave={onSavePluginConfig}
              onSetEnabled={onSetPluginEnabled}
            />
            <ModelSelector
              disabled={disabled || running}
              models={modelProviders}
              selectedId={selectedModelProviderId}
              onSelect={onSelectModelProvider}
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
            label="移除附件"
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
  onSelect,
  prefersCompactControls,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  prefersCompactControls: boolean;
}): JSX.Element {
  const selected = useMemo(
    () => readSelectedModelProvider(models, selectedId) ?? null,
    [models, selectedId],
  );
  const label = selected?.title ?? selected?.model ?? "...";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || models.length === 0}>
        <MotionButton
          className={cn(
            "inline-flex h-9 min-w-0 max-w-[180px] items-center gap-1.5 rounded-md px-2 text-[11px] sm:h-7 sm:max-w-[230px]",
            prefersCompactControls && "min-h-11 min-w-11",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            (disabled || models.length === 0) && "pointer-events-none opacity-55",
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
        <DropdownMenuLabel>模型</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.map((model) => {
          const active = model.id === selected?.id;
          return (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => onSelect(model.id)}
              className="h-auto items-start py-2"
              icon={active
                ? <Check className="h-3.5 w-3.5 text-terra-500" />
                : (
                  <ModelProviderIcon
                    icon={model.icon}
                    size={14}
                  />
                )}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] text-ink-850">{model.title}</span>
                <span className="truncate font-mono text-[10.5px] text-ink-400">
                  {model.endpoint} · {model.model}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
