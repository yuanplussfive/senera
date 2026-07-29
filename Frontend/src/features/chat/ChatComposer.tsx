import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Check, ChevronDown, Paperclip, RotateCcw, Square, X } from "lucide-react";
import type { UploadAttachmentData, ModelProviderListItem } from "../../api/eventTypes";
import type { UploadProgress } from "../../api/uploadClient";
import { cn, formatFileSize } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useResponsiveMode } from "../../shared/responsive";
import { MotionButton, MotionList, MotionPresenceItem, motionTimings, useMotionLevel } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ConversationFrame,
  IconButton,
  Spinner,
  Tooltip,
} from "../../shared/ui";
import { FilePreviewIcon } from "./FilePreviewIcon";
import { PresetControl } from "./PresetPanel";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { readChatModelProviders, readSelectedModelProvider } from "./modelProvider";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { ChatModelConfig, ChatPresetConfig } from "./ChatPanelContracts";
import { useComposerAttachments, type PendingAttachment } from "./useComposerAttachments";

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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachments = useComposerAttachments({
    uploadUrl: runtime.uploadUrl,
    uploadCsrfToken: runtime.uploadCsrfToken,
    interactionLocked: disabled || running,
  });
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;

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

  const submit = (queueMode?: MessageQueueMode): void => {
    const text = value.trim();
    if (!text || disabled || attachments.uploading) return;
    const uploaded = attachments.collectUploadedAttachments();
    const sent = onSend(text, uploaded.length > 0 ? uploaded : undefined, queueMode);
    if (sent === false) return;
    attachments.commitSentAttachments();
    setValue("");
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

  const canSend = !disabled && !attachments.uploading && value.trim().length > 0;
  const { reduceMotion, disableMotion } = useMotionLevel();
  const cancelButtonHidden = reduceMotion ? { opacity: 0 } : { opacity: 0, x: 4, scale: 0.96 };

  return (
    <div className="bg-transparent py-3 sm:py-4">
      <ConversationFrame mode="composer">
        <div
          onDragEnter={attachments.handleDragEnter}
          onDragOver={attachments.handleDragOver}
          onDragLeave={attachments.handleDragLeave}
          onDrop={attachments.handleDrop}
          className={cn(
            "relative flex min-w-0 flex-col rounded-[18px] border border-line bg-surface-raised px-3.5 pb-2.5 pt-2.5 shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow] duration-150",
            attachments.isDraggingFiles && "border-accent-border bg-accent-surface ring-2 ring-accent-focus",
          )}
          data-chat-composer
        >
          {attachments.isDraggingFiles ? (
            <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-md border border-dashed border-accent-border bg-surface-panel text-[13px] font-medium text-accent-content">
              {frontendMessage("chat.composer.dropFiles")}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={attachments.handleFileSelection}
          />
          <AttachmentTray
            attachments={attachments.pendingAttachments}
            onRemove={attachments.removeAttachment}
            onRetry={attachments.retryAttachment}
            onPreviewUnavailable={attachments.markPreviewUnavailable}
          />

          <textarea
            ref={taRef}
            aria-label={frontendMessage("chat.composer.inputMessage")}
            value={value}
            rows={1}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={attachments.handlePaste}
            placeholder={hint}
            disabled={disabled}
            style={{ maxHeight: textareaMaxHeight }}
            className="scrollbar-thin min-h-10 w-full resize-none bg-transparent px-1 py-2 text-[14.5px] leading-6 text-content-primary placeholder:text-content-secondary focus:outline-none disabled:opacity-60 sm:min-h-10"
          />

          <div className="flex min-w-0 items-center gap-2 pt-0.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <IconButton
                label="attach"
                tooltip={frontendMessage("chat.attachment.tooltip")}
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

            <div className="flex shrink-0 items-center gap-1.5">
              <AnimatePresence initial={false}>
                {running ? (
                  <motion.div
                    key="cancel-running"
                    initial={disableMotion ? false : cancelButtonHidden}
                    animate={{
                      opacity: 1,
                      x: 0,
                      scale: 1,
                      transition: disableMotion ? { duration: 0 } : motionTimings.fast,
                    }}
                    exit={{
                      ...cancelButtonHidden,
                      transition: disableMotion ? { duration: 0 } : { duration: 0.1, ease: motionTimings.fast.ease },
                    }}
                    className="shrink-0"
                  >
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
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <Tooltip
                content={frontendMessage(running ? "chat.composer.inject" : "chat.composer.send")}
                side="top"
                shortcut={prefersCompactControls ? undefined : "↵"}
              >
                <MotionButton
                  onClick={() => submit(running ? "steer" : undefined)}
                  disabled={!canSend}
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-chat-composer-focus-bg)] disabled:pointer-events-none",
                    prefersCompactControls && "min-h-11 min-w-11",
                    canSend
                      ? "border-content-strong bg-content-strong text-content-inverse shadow-panel hover:border-accent-solid hover:bg-accent-solid hover:text-accent-on-solid active:bg-accent-solid-pressed"
                      : "border-line-subtle bg-surface-muted text-content-disabled",
                  )}
                  aria-label={running ? "inject-current-run" : "send"}
                >
                  <ArrowUp className="h-4 w-4" />
                </MotionButton>
              </Tooltip>
            </div>
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
  onRetry,
  onPreviewUnavailable,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPreviewUnavailable: (id: string) => void;
}): JSX.Element {
  return (
    <MotionList className="flex flex-wrap gap-1.5 px-0.5 pb-1">
      {attachments.map((entry) => (
        <MotionPresenceItem key={entry.id} className={cn(entry.previewUrl && "shrink-0")}>
          {entry.previewUrl && entry.status !== "error" ? (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line-subtle bg-surface-muted">
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
              className={cn(
                "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
                entry.status === "uploading" && "min-w-[210px]",
                entry.status === "error"
                  ? "border-brick-200 bg-brick-50 text-brick-700"
                  : "border-line-subtle bg-surface-raised text-content-secondary",
              )}
            >
              <span className="relative shrink-0">
                {entry.previewUrl ? (
                  <img src={entry.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <FilePreviewIcon name={entry.fileName} mime={entry.mime ?? entry.attachment?.mime} />
                )}
                {entry.status === "uploading" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-surface-raised bg-surface-raised">
                    <Spinner size="xs" className="h-2.5 w-2.5 text-accent-content" />
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
                  <span className="shrink-0 font-mono text-[10px] text-content-muted">
                    {formatFileSize(entry.size)}
                  </span>
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
                {entry.status === "error" ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-brick-600">
                    <span className="min-w-0 truncate" title={entry.error ?? undefined}>
                      {entry.error ?? frontendMessage("upload.fileFailed")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRetry(entry.id)}
                      aria-label={frontendMessage("chat.attachment.retryUploadNamed", { name: entry.fileName })}
                      className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-2 font-medium text-brick-700 hover:bg-brick-100"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      {frontendMessage("chat.attachment.retryUpload")}
                    </button>
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
          )}
        </MotionPresenceItem>
      ))}
    </MotionList>
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
