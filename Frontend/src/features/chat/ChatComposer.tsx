import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  BookUser,
  Check,
  ChevronDown,
  Paperclip,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { buildStyles, CircularProgressbar } from "react-circular-progressbar";
import type { UploadAttachmentData, ModelProviderListItem } from "../../api/eventTypes";
import type { UploadProgress } from "../../api/uploadClient";
import { cn, formatFileSize } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendChatMessage } from "../../i18n/frontendChatMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { useResponsiveMode } from "../../shared/responsive";
import { MotionButton, MotionList, MotionListItem } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import type { ChatApprovalConfig, ChatModelConfig, ChatPresetConfig } from "./ChatPanelContracts";
import { useComposerAttachments, type PendingAttachment } from "./useComposerAttachments";
import type { RuntimeContextUsage, RuntimeUsageSnapshot } from "../observability/runtimeDiagnosticProjection";

const ApprovalModeControl = lazy(() => import("./ApprovalModeControl"));

const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const TOUCH_TEXTAREA_MAX_HEIGHT = 160;
const ACTIVE_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export interface ChatComposerProps {
  disabled: boolean;
  running: boolean;
  settling?: boolean;
  cancelling?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  modelConfig: ChatModelConfig;
  approvalConfig: ChatApprovalConfig;
  presetConfig: ChatPresetConfig;
  runtime: {
    socketStatus: string;
    uploadUrl: string;
    uploadCsrfToken?: string;
  };
  runtimeUsage?: RuntimeUsageSnapshot;
  onSend: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => boolean;
  onCancel: () => void;
}

export function ChatComposer({
  disabled,
  running,
  settling = false,
  cancelling = false,
  value: controlledValue,
  onValueChange,
  modelConfig,
  runtimeUsage,
  approvalConfig,
  presetConfig,
  runtime,
  onSend,
  onCancel,
}: ChatComposerProps): JSX.Element {
  const locale = useFrontendLocale();
  const [internalValue, setInternalValue] = useState("");
  const value = controlledValue ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openPresetAfterToolkitCloseRef = useRef(false);
  const [toolkitOpen, setToolkitOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const attachments = useComposerAttachments({
    uploadUrl: runtime.uploadUrl,
    uploadCsrfToken: runtime.uploadCsrfToken,
    interactionLocked: disabled || running || cancelling,
  });
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;

  const hint = useMemo(() => {
    if (cancelling) return frontendMessage("chat.composer.hintCancelling", {}, locale);
    if (settling) return frontendMessage("chat.composer.hintSettling", {}, locale);
    if (running) {
      return frontendMessage(
        prefersCompactControls ? "chat.composer.hintRunningCompact" : "chat.composer.hintRunning",
        {},
        locale,
      );
    }
    if (runtime.socketStatus === "open") return frontendMessage("chat.composer.hintOpen", {}, locale);
    if (runtime.socketStatus === "connecting" || runtime.socketStatus === "idle") {
      return frontendMessage("chat.composer.hintIdle", {}, locale);
    }
    return frontendMessage("chat.composer.hintDisconnected", {}, locale);
  }, [cancelling, locale, prefersCompactControls, runtime.socketStatus, running, settling]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        taRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && running && !cancelling && !settling) {
        if (e.defaultPrevented || hasActiveInteractionLayer(e)) return;
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cancelling, running, settling, onCancel]);

  useEffect(() => {
    if (!taRef.current) return;
    const el = taRef.current;
    el.style.height = "auto";
    el.style.height = value ? `${Math.min(el.scrollHeight, textareaMaxHeight)}px` : "auto";
  }, [textareaMaxHeight, value]);

  useEffect(() => {
    if (controlledValue === undefined || !controlledValue || document.activeElement === taRef.current) return;
    taRef.current?.focus();
    taRef.current?.setSelectionRange(controlledValue.length, controlledValue.length);
  }, [controlledValue]);

  useEffect(() => {
    if (toolkitOpen || !openPresetAfterToolkitCloseRef.current) return;
    openPresetAfterToolkitCloseRef.current = false;
    setPresetOpen(true);
  }, [toolkitOpen]);

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
      submit(settling ? "follow_up" : running && e.altKey ? "follow_up" : running ? "steer" : undefined);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, textareaMaxHeight)}px`;
  };

  const canSend = !disabled && !attachments.uploading && value.trim().length > 0;

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
              <DropdownMenu open={toolkitOpen} onOpenChange={setToolkitOpen}>
                <DropdownMenuTrigger asChild disabled={disabled || running || cancelling}>
                  <IconButton
                    label={frontendChatMessage("chat.composer.toolkit.tooltip")}
                    tooltip={frontendChatMessage("chat.composer.toolkit.tooltip")}
                    tooltipSide="top"
                    tone="muted"
                    disabled={disabled || running || cancelling}
                    touchSafe
                    className="[&[data-state=open]>svg]:rotate-45"
                  >
                    <Plus className="h-4 w-4 transition-transform duration-[var(--icon-rotate-dur)] ease-[var(--icon-rotate-ease)]" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={6} alignOffset={6}>
                  <DropdownMenuItem
                    icon={<Paperclip className="h-4 w-4" />}
                    onSelect={() => fileInputRef.current?.click()}
                  >
                    {frontendChatMessage("chat.composer.toolkit.fileAndImage")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<BookUser className="h-4 w-4" />}
                    onSelect={() => {
                      openPresetAfterToolkitCloseRef.current = true;
                    }}
                  >
                    {frontendChatMessage("chat.composer.toolkit.preset")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <PresetControl
                open={presetOpen}
                onOpenChange={setPresetOpen}
                disabled={disabled || running || cancelling}
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
              <Suspense fallback={<span className={cn("h-7 w-24 shrink-0", prefersCompactControls && "h-11 w-11")} />}>
                <ApprovalModeControl
                  disabled={disabled || running || cancelling}
                  mode={approvalConfig.mode}
                  onSelect={approvalConfig.onSelectMode}
                  prefersCompactControls={prefersCompactControls}
                />
              </Suspense>
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-1" data-composer-trailing-controls>
              <ContextUsageIndicator usage={runtimeUsage?.contextUsage} />
              <ModelSelector
                disabled={disabled || running}
                models={modelConfig.modelProviders}
                selectedId={modelConfig.selectedModelProviderId}
                defaultModelId={modelConfig.defaultModelProviderId}
                onSelect={modelConfig.onSelectModelProvider}
                onUseDefault={modelConfig.onApplyDefaultModel}
                onAddModel={modelConfig.onAddModel}
                prefersCompactControls={prefersCompactControls}
              />
              {cancelling ? (
                <Tooltip content={frontendMessage("chat.composer.cancelling")} side="top">
                  <MotionButton
                    disabled
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-content-muted",
                      prefersCompactControls && "min-h-11 min-w-11",
                    )}
                    aria-label="cancelling"
                  >
                    <Spinner size="sm" />
                  </MotionButton>
                </Tooltip>
              ) : running && !settling ? (
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
                  content={frontendMessage(settling ? "chat.composer.followUp" : "chat.composer.send")}
                  side="top"
                  shortcut={prefersCompactControls ? undefined : "↵"}
                >
                  <MotionButton
                    onClick={() => submit(settling ? "follow_up" : undefined)}
                    disabled={!canSend}
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-chat-composer-focus-bg)] disabled:pointer-events-none",
                      prefersCompactControls && "min-h-11 min-w-11",
                      canSend
                        ? "border-content-strong bg-content-strong text-content-inverse shadow-panel hover:border-accent-solid hover:bg-accent-solid hover:text-accent-on-solid active:bg-accent-solid-pressed"
                        : "border-line-subtle bg-surface-muted text-content-disabled",
                    )}
                    aria-label={settling ? "queue-follow-up" : "send"}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </MotionButton>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </ConversationFrame>
    </div>
  );
}

function ContextUsageIndicator({ usage }: { usage?: RuntimeContextUsage }): JSX.Element {
  const hasTokens = usage?.tokens !== null && usage?.tokens !== undefined;
  const used = hasTokens ? Math.max(0, usage.tokens) : 0;
  const percent = usage
    ? Math.max(0, Math.min(100, usage.percent ?? (hasTokens ? (used / usage.contextWindow) * 100 : 0)))
    : 0;
  const value = usage && hasTokens ? percent : 0;
  const roundedPercent = Math.round(percent);
  const remainingPercent = Math.max(0, 100 - roundedPercent);

  return (
    <Tooltip
      content={
        <span className="grid gap-0.5 text-left leading-5">
          <span className="font-medium">
            {usage && hasTokens
              ? frontendMessage("chat.composer.contextUsageSummary", {
                  used: roundedPercent,
                  remaining: remainingPercent,
                })
              : frontendMessage("chat.composer.contextUsage")}
          </span>
          <span className="tabular-nums text-ink-300">
            {usage && hasTokens
              ? frontendMessage("chat.composer.contextUsageTokens", {
                  used: formatComposerTokenCount(used),
                  total: formatComposerTokenCount(usage.contextWindow),
                })
              : frontendMessage("chat.composer.contextUsagePending")}
          </span>
        </span>
      }
      side="top"
      delayDuration={120}
    >
      <span
        role="progressbar"
        tabIndex={0}
        aria-label={frontendMessage("chat.composer.contextUsage")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={
          usage && hasTokens ? `${roundedPercent}%` : frontendMessage("chat.composer.contextUsagePending")
        }
        data-context-usage-indicator
        className={cn(
          "mx-0.5 inline-block h-4 w-4 shrink-0 rounded-full outline-none opacity-75 transition-[filter,opacity] hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent-focus",
        )}
      >
        <CircularProgressbar
          value={value}
          strokeWidth={11}
          className="h-full w-full align-middle"
          aria-hidden="true"
          styles={buildStyles({
            pathColor: "var(--accent-solid)",
            trailColor: "var(--line-subtle)",
            strokeLinecap: "round",
            pathTransitionDuration: 0.35,
          })}
        />
      </span>
    </Tooltip>
  );
}

function formatComposerTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimCompactNumber(tokens / 1_000_000)}m`;
  if (tokens >= 1_000) return `${trimCompactNumber(tokens / 1_000)}k`;
  return `${Math.round(tokens)}`;
}

function trimCompactNumber(value: number): string {
  return (value >= 10 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/u, "");
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
        <MotionListItem key={entry.id} layout="position" className={cn(entry.previewUrl && "shrink-0")}>
          {entry.previewUrl ? (
            <div
              className={cn(
                "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-surface-muted",
                entry.status === "error" ? "border-brick-500" : "border-line-subtle",
              )}
            >
              <img
                src={entry.previewUrl}
                alt={entry.fileName}
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
                <Tooltip content={entry.error ?? frontendMessage("ui.retry")} side="top">
                  <button
                    type="button"
                    onClick={() => onRetry(entry.id)}
                    aria-label={frontendMessage("ui.retry")}
                    className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-brick-50 text-brick-600 transition hover:bg-brick-100"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </Tooltip>
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
                <FilePreviewIcon name={entry.fileName} mime={entry.mime ?? entry.attachment?.mime} />
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
                    <Tooltip content={entry.error ?? frontendMessage("upload.fileFailed")} side="top">
                      <span className="min-w-0 truncate">{entry.error ?? frontendMessage("upload.fileFailed")}</span>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => onRetry(entry.id)}
                      className="shrink-0 font-medium underline underline-offset-2 hover:text-brick-700"
                    >
                      {frontendMessage("ui.retry")}
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
        </MotionListItem>
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
  onAddModel,
  prefersCompactControls,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  defaultModelId?: string | null;
  onSelect: (id: string) => void;
  onUseDefault?: () => void;
  onAddModel?: () => void;
  prefersCompactControls: boolean;
}): JSX.Element {
  const chatModels = useMemo(() => readChatModelProviders(models), [models]);
  const selected = useMemo(() => readSelectedModelProvider(chatModels, selectedId) ?? null, [chatModels, selectedId]);
  const label = selected ? readModelSelectorLabel(selected) : frontendMessage("chat.composer.selectModel");
  const defaultModel = useMemo(
    () => readSelectedModelProvider(chatModels, defaultModelId ?? null) ?? null,
    [chatModels, defaultModelId],
  );
  const usesDefault = Boolean(defaultModel && defaultModel.id === selected?.id);
  const selectorDisabled = disabled || (chatModels.length === 0 && !onAddModel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={selectorDisabled}>
        <MotionButton
          className={cn(
            "group inline-flex h-8 min-w-0 max-w-[190px] items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11.5px] font-medium",
            prefersCompactControls && "h-9 max-w-[122px] px-1",
            "text-content-muted shadow-none transition-colors hover:bg-surface-hover hover:text-content-primary data-[state=open]:bg-surface-hover data-[state=open]:text-content-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            selectorDisabled && "pointer-events-none opacity-55",
          )}
          aria-label={frontendMessage("chat.composer.selectModel")}
          data-composer-model-selector
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-content-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
        </MotionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[min(280px,calc(100vw-24px))]">
        <DropdownMenuLabel>{frontendMessage("chat.model.currentConversation")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {chatModels.length > 0 ? (
          <DropdownMenuGroup className="max-h-[min(360px,calc(100dvh-200px))] overflow-y-auto pr-1 scrollbar-thin">
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
                  <span className="min-w-0 truncate text-[13px] text-content-primary">
                    {readModelSelectorLabel(model)}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ) : (
          <div className="px-2 py-3 text-[12px] text-content-muted">{frontendMessage("config.model.noConfigured")}</div>
        )}
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
        {onAddModel ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onAddModel}
              className="h-10 bg-surface-muted py-2"
              icon={<Settings2 className="h-3.5 w-3.5 text-content-secondary" />}
            >
              <span className="min-w-0 truncate text-[13px] text-content-primary">
                {frontendMessage("config.model.addModel")}
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
