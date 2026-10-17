import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { buildStyles, CircularProgressbar } from "react-circular-progressbar";
import type { UploadAttachmentData } from "../../api/eventTypes";
import type {
  AgentActivationCatalogSnapshot,
  ExplicitActivationReference,
  ExplicitActivationSet,
} from "../../api/eventTypes";
import { WorkspaceMenu } from "../../shared/workspace/WorkspaceMenu";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ConversationFrame,
  IconButton,
  Spinner,
  Tooltip,
  AppIcon,
} from "../../shared/ui";
import { FilePreviewIcon } from "./FilePreviewIcon";
import { FilePreviewDialog } from "../../shared/media/FilePreviewDialog";
import { isImageFilePreview } from "../../lib/filePreview";
import { ChatModelSelector } from "./ChatModelSelector";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { ChatApprovalConfig, ChatModelConfig } from "./ChatPanelContracts";
import type { SettingsSectionId } from "../settings/settingsSectionContract";
import { useComposerAttachments, type PendingAttachment } from "./useComposerAttachments";
import type { RuntimeContextUsage, RuntimeUsageSnapshot } from "../observability/runtimeDiagnosticProjection";
import {
  ActivationPalette,
  ActivationTextOverlay,
  rankActivationCandidates,
  readActivationQuery,
  readActivationTokens,
  stepActivationIndex,
} from "./ChatActivationPalette";

const ApprovalModeControl = lazy(() => import("./ApprovalModeControl"));

const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const TOUCH_TEXTAREA_MAX_HEIGHT = 160;
const ACTIVE_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export type ComposerAction = "send" | "follow_up" | "steer" | "cancel" | "cancelling";

export function readComposerAction({
  running,
  settling,
  cancelling,
  canSubmit,
}: {
  running: boolean;
  settling: boolean;
  cancelling: boolean;
  canSubmit: boolean;
}): ComposerAction {
  if (cancelling) return "cancelling";
  if (settling) return "follow_up";
  if (!running) return "send";
  return canSubmit ? "steer" : "cancel";
}

export interface ChatComposerProps {
  disabled: boolean;
  running: boolean;
  settling?: boolean;
  cancelling?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  modelConfig: ChatModelConfig;
  approvalConfig: ChatApprovalConfig;
  runtime: {
    draftKey?: string;
    socketStatus: string;
    uploadUrl: string;
    uploadCsrfToken?: string;
  };
  runtimeUsage?: RuntimeUsageSnapshot;
  onSend: (
    input: string,
    attachments?: UploadAttachmentData[],
    queueMode?: MessageQueueMode,
    activations?: ExplicitActivationSet,
  ) => boolean;
  onCancel: () => void;
  onOpenSettings?: (section: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
  activationCatalog?: AgentActivationCatalogSnapshot | null;
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
  runtime,
  onSend,
  onCancel,
  onOpenSettings,
  activationCatalog,
}: ChatComposerProps): JSX.Element {
  const locale = useFrontendLocale();
  const [internalValue, setInternalValue] = useState("");
  const value = controlledValue ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const textOverlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSettingsSectionRef = useRef<SettingsSectionId | null>(null);
  const [toolkitOpen, setToolkitOpen] = useState(false);
  const [activationSelection, setActivationSelection] = useState<ExplicitActivationReference[]>([]);
  const [activationQuery, setActivationQuery] = useState<string | null>(null);
  const [activationIndex, setActivationIndex] = useState(0);
  const workspaceResources = useWorkspaceResourceController();
  const attachments = useComposerAttachments({
    draftKey: runtime.draftKey,
    uploadUrl: runtime.uploadUrl,
    uploadCsrfToken: runtime.uploadCsrfToken,
    interactionLocked: disabled || running || cancelling,
  });
  const attachmentHandler = useRef(attachments.enqueueFiles);
  attachmentHandler.current = attachments.enqueueFiles;
  const registerReferenceHandler = workspaceResources?.registerReferenceHandler;
  useEffect(() => {
    if (disabled || cancelling) return;
    return registerReferenceHandler?.((file) => attachmentHandler.current([file]));
  }, [disabled, cancelling, registerReferenceHandler]);
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;
  const showActivationOverlay = /(?:^|\s)@[^\s@]*/u.test(value);

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

  const canSend = !disabled && !attachments.uploading && value.trim().length > 0;
  const composerAction = readComposerAction({ running, settling, cancelling, canSubmit: canSend });

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
    if (!showActivationOverlay || !taRef.current || !textOverlayRef.current) return;
    textOverlayRef.current.scrollTop = taRef.current.scrollTop;
    textOverlayRef.current.scrollLeft = taRef.current.scrollLeft;
  }, [showActivationOverlay]);

  useEffect(() => {
    if (controlledValue === undefined || !controlledValue || document.activeElement === taRef.current) return;
    taRef.current?.focus();
    taRef.current?.setSelectionRange(controlledValue.length, controlledValue.length);
  }, [controlledValue]);

  useEffect(() => {
    if (toolkitOpen) return;
    const pendingSection = pendingSettingsSectionRef.current;
    if (!pendingSection || !onOpenSettings) return;
    pendingSettingsSectionRef.current = null;
    onOpenSettings(pendingSection);
  }, [onOpenSettings, toolkitOpen]);

  useEffect(() => {
    setActivationSelection((current) => {
      const next = current.filter((selection) =>
        activationCatalog?.entries.some(
          (entry) =>
            entry.kind === selection.kind && entry.id === selection.id && entry.revision === selection.revision,
        ),
      );
      return next.length === current.length ? current : next;
    });
    if (!activationCatalog) setActivationQuery(null);
  }, [activationCatalog]);

  const activationCanSelect = !disabled && !running && !settling && !cancelling;
  const activationCandidates = useMemo(() => {
    if (activationQuery === null || !activationCatalog || !activationCanSelect) return [];
    return rankActivationCandidates(activationCatalog.entries, activationQuery, locale);
  }, [activationCanSelect, activationCatalog, activationQuery, locale]);

  useEffect(() => {
    if (activationCanSelect) return;
    setActivationQuery(null);
    setActivationIndex(0);
  }, [activationCanSelect]);

  useEffect(() => {
    setActivationIndex((current) => {
      if (activationCandidates.length === 0) return 0;
      if (activationCandidates[current]?.selectable) return current;
      const firstSelectable = activationCandidates.findIndex((entry) => entry.selectable);
      return firstSelectable >= 0 ? firstSelectable : 0;
    });
  }, [activationCandidates]);

  const selectActivation = (index: number): void => {
    const candidate = activationCandidates[index];
    if (!candidate?.selectable || activationQuery === null) return;
    const caret = taRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/u);
    if (!match) return;
    const tokenStart = caret - match[1].length - 1;
    const nextValue = `${value.slice(0, tokenStart)}@${candidate.id} ${value.slice(caret)}`;
    setValue(nextValue);
    setActivationSelection((current) =>
      current.some((entry) => entry.kind === candidate.kind && entry.id === candidate.id)
        ? current
        : [...current, { kind: candidate.kind, id: candidate.id, revision: candidate.revision }],
    );
    setActivationQuery(null);
    setActivationIndex(0);
    requestAnimationFrame(() => {
      const nextCaret = tokenStart + candidate.id.length + 2;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const submit = (queueMode?: MessageQueueMode): void => {
    const text = value.trim();
    if (!text || disabled || attachments.uploading) return;
    const uploaded = attachments.collectUploadedAttachments();
    const activations: ExplicitActivationSet | undefined =
      activationSelection.length > 0 && activationCatalog
        ? { catalogRevision: activationCatalog.revision, explicit: activationSelection }
        : undefined;
    const sent = activations
      ? onSend(text, uploaded.length > 0 ? uploaded : undefined, queueMode, activations)
      : onSend(text, uploaded.length > 0 ? uploaded : undefined, queueMode);
    if (sent === false) return;
    attachments.commitSentAttachments();
    setValue("");
    setActivationSelection([]);
    setActivationQuery(null);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (activationQuery !== null && activationCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActivationIndex((current) => stepActivationIndex(activationCandidates, current, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActivationIndex((current) => stepActivationIndex(activationCandidates, current, -1));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectActivation(activationIndex);
        return;
      }
      if (e.key === "Escape") {
        setActivationQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (composerAction === "cancel" || composerAction === "cancelling") return;
      submit(
        composerAction === "follow_up" || (composerAction === "steer" && e.altKey)
          ? "follow_up"
          : composerAction === "steer"
            ? "steer"
            : undefined,
      );
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextValue = e.target.value;
    setValue(nextValue);
    const referencedIds = new Set(readActivationTokens(nextValue));
    setActivationSelection((current) => current.filter((entry) => referencedIds.has(entry.id)));
    setActivationQuery(activationCanSelect ? readActivationQuery(nextValue, e.target.selectionStart) : null);
    setActivationIndex(0);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, textareaMaxHeight)}px`;
  };

  const handleComposerAction = (): void => {
    switch (composerAction) {
      case "cancel":
        onCancel();
        return;
      case "cancelling":
        return;
      case "follow_up":
        submit("follow_up");
        return;
      case "steer":
        submit("steer");
        return;
      case "send":
        submit();
        return;
    }
  };

  return (
    <div className="bg-transparent pb-4 pt-3 sm:pb-5 sm:pt-3.5">
      <ConversationFrame mode="composer">
        <div
          onDragEnter={attachments.handleDragEnter}
          onDragOver={attachments.handleDragOver}
          onDragLeave={attachments.handleDragLeave}
          onDrop={attachments.handleDrop}
          className={cn(
            "relative flex min-w-0 flex-col gap-2 rounded-[14px] border border-line-subtle bg-surface-raised px-3.5 pb-2.5 pt-[13px] shadow-[0_12px_32px_-16px_rgb(43_40_32_/_0.10)] transition-[background-color,border-color,box-shadow] duration-150",
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

          <div className="relative min-h-9">
            {showActivationOverlay ? <ActivationTextOverlay ref={textOverlayRef} value={value} /> : null}
            <textarea
              ref={taRef}
              aria-label={frontendMessage("chat.composer.inputMessage")}
              value={value}
              rows={1}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={attachments.handlePaste}
              onScroll={() => {
                if (!taRef.current || !textOverlayRef.current) return;
                textOverlayRef.current.scrollTop = taRef.current.scrollTop;
                textOverlayRef.current.scrollLeft = taRef.current.scrollLeft;
              }}
              placeholder={hint}
              disabled={disabled}
              style={{ maxHeight: textareaMaxHeight }}
              className={cn(
                "scrollbar-thin relative z-[1] min-h-9 w-full resize-none bg-transparent px-1 py-1.5 font-sans text-[14px] leading-5 caret-accent-content selection:bg-accent-surface selection:text-content-primary placeholder:text-content-disabled focus:outline-none disabled:opacity-60 sm:min-h-9",
                showActivationOverlay ? "text-transparent" : "text-content-primary",
              )}
            />
          </div>
          {activationQuery !== null && activationCanSelect ? (
            <ActivationPalette
              catalog={activationCatalog}
              query={activationQuery}
              candidates={activationCandidates}
              activeIndex={activationIndex}
              selected={activationSelection}
              locale={locale}
              onSelect={selectActivation}
            />
          ) : null}

          <div className="flex min-w-0 items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <DropdownMenu modal={false} open={toolkitOpen} onOpenChange={setToolkitOpen}>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label={frontendChatMessage("chat.composer.toolkit.tooltip")}
                    tooltip={frontendChatMessage("chat.composer.toolkit.tooltip")}
                    tooltipSide="top"
                    tone="muted"
                    touchSafe
                    className="[&[data-state=open]>svg]:rotate-45"
                  >
                    <AppIcon
                      icon="plus"
                      size={16}
                      className="transition-transform duration-[var(--icon-rotate-dur)] ease-[var(--icon-rotate-ease)]"
                    />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={6} alignOffset={6}>
                  <WorkspaceMenu onClose={() => setToolkitOpen(false)} />
                  <DropdownMenuItem
                    icon={<AppIcon icon="paperclip" size={16} />}
                    disabled={disabled || running || cancelling}
                    onSelect={() => fileInputRef.current?.click()}
                  >
                    {frontendChatMessage("chat.composer.toolkit.fileAndImage")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<AppIcon icon="file-text" size={16} />}
                    disabled={disabled || running || cancelling || !onOpenSettings}
                    onSelect={() => {
                      pendingSettingsSectionRef.current = "prompt";
                    }}
                  >
                    {frontendChatMessage("chat.composer.toolkit.persona")}
                  </DropdownMenuItem>
                  {onOpenSettings ? (
                    <>
                      <DropdownMenuItem
                        icon={<AppIcon icon="puzzle" size={16} />}
                        onSelect={() => {
                          pendingSettingsSectionRef.current = "mcp-servers";
                        }}
                      >
                        {frontendChatMessage("chat.composer.toolkit.plugins")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<AppIcon icon="wand" size={16} />}
                        onSelect={() => {
                          pendingSettingsSectionRef.current = "system-tools";
                        }}
                      >
                        {frontendChatMessage("chat.composer.toolkit.skills")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<AppIcon icon="globe" size={16} />}
                        onSelect={() => {
                          pendingSettingsSectionRef.current = "system-tools";
                        }}
                      >
                        {frontendChatMessage("chat.composer.toolkit.webSearch")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              <Suspense
                fallback={
                  <span
                    className={cn(
                      "inline-flex h-7 w-24 shrink-0 items-center justify-center text-content-muted",
                      prefersCompactControls && "h-11 w-11",
                    )}
                    role="status"
                    aria-busy="true"
                    aria-label={frontendMessage("ui.loading")}
                  >
                    <Spinner size="xs" />
                  </span>
                }
              >
                <ApprovalModeControl
                  disabled={disabled || running || cancelling}
                  mode={approvalConfig.mode}
                  onSelect={approvalConfig.onSelectMode}
                  prefersCompactControls={prefersCompactControls}
                />
              </Suspense>
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-1" data-composer-trailing-controls>
              <RuntimeUsageIndicator runtimeUsage={runtimeUsage} />
              <ChatModelSelector
                disabled={disabled || running}
                models={modelConfig.modelProviders}
                selectedId={modelConfig.selectedModelProviderId}
                defaultModelId={modelConfig.defaultModelProviderId}
                selectedThinkingLevel={modelConfig.selectedThinkingLevel}
                onSelect={modelConfig.onSelectModelProvider}
                onSelectThinkingLevel={modelConfig.onSelectThinkingLevel}
                onUseDefault={modelConfig.onApplyDefaultModel}
                onAddModel={modelConfig.onAddModel}
                prefersCompactControls={prefersCompactControls}
              />
              {composerAction === "cancelling" ? (
                <Tooltip content={frontendMessage("chat.composer.cancelling")} side="top">
                  <MotionButton
                    disabled
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-content-muted",
                      prefersCompactControls && "min-h-11 min-w-11",
                    )}
                    aria-label={frontendMessage("chat.composer.cancelling")}
                    data-composer-action="cancelling"
                  >
                    <Spinner size="sm" />
                  </MotionButton>
                </Tooltip>
              ) : composerAction === "cancel" ? (
                <Tooltip
                  content={frontendMessage("chat.composer.cancelRunning")}
                  side="top"
                  shortcut={prefersCompactControls ? undefined : "Esc"}
                >
                  <MotionButton
                    onClick={handleComposerAction}
                    disabled={disabled}
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brick-200 bg-surface-raised text-brick-600 transition-colors duration-150 hover:bg-brick-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick-200 disabled:pointer-events-none disabled:opacity-50",
                      prefersCompactControls && "min-h-11 min-w-11",
                    )}
                    aria-label={frontendMessage("chat.composer.cancelRunning")}
                    data-composer-action="cancel"
                  >
                    <AppIcon icon="square" size={14} className="fill-current" />
                  </MotionButton>
                </Tooltip>
              ) : (
                <Tooltip
                  content={frontendMessage(
                    composerAction === "steer"
                      ? "chat.composer.inject"
                      : composerAction === "follow_up"
                        ? "chat.composer.followUp"
                        : "chat.composer.send",
                  )}
                  side="top"
                  shortcut={prefersCompactControls ? undefined : "↵"}
                >
                  <MotionButton
                    onClick={handleComposerAction}
                    disabled={!canSend}
                    className={cn(
                      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-chat-composer-focus-bg)] disabled:pointer-events-none",
                      prefersCompactControls && "min-h-11 min-w-11",
                      canSend
                        ? "bg-content-strong text-content-inverse hover:bg-accent-solid hover:text-accent-on-solid active:bg-accent-solid-pressed"
                        : "bg-surface-muted text-content-disabled",
                    )}
                    aria-label={
                      composerAction === "steer"
                        ? "inject-current-run"
                        : composerAction === "follow_up"
                          ? "queue-follow-up"
                          : "send"
                    }
                    data-composer-action={composerAction}
                  >
                    <AppIcon icon="arrow-up" size={16} />
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

function ContextUsageIndicator({ usage }: { usage?: RuntimeContextUsage }): JSX.Element | null {
  const hasTokens = typeof usage?.tokens === "number" && Number.isFinite(usage.tokens);
  const hasContextWindow = typeof usage?.contextWindow === "number" && Number.isFinite(usage.contextWindow);
  if (!usage || !hasTokens || !hasContextWindow || usage.contextWindow <= 0) return null;

  const used = Math.max(0, usage.tokens);
  const percent = Math.max(0, Math.min(100, usage.percent ?? (used / usage.contextWindow) * 100));
  const roundedPercent = Math.round(percent);
  const remainingPercent = Math.max(0, 100 - roundedPercent);

  return (
    <Tooltip
      content={
        <span className="flex items-center gap-1 whitespace-nowrap text-left leading-4 tabular-nums">
          <span className="font-medium">
            {frontendMessage("chat.composer.contextUsageSummary", {
              used: roundedPercent,
              remaining: remainingPercent,
            })}
          </span>
          <span className="text-ink-300">·</span>
          <span className="text-ink-300">
            {frontendMessage("chat.composer.contextUsageTokens", {
              used: formatComposerTokenCount(used),
              total: formatComposerTokenCount(usage.contextWindow),
            })}
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
        aria-valuenow={percent}
        aria-valuetext={`${roundedPercent}%`}
        data-context-usage-indicator
        className="inline-block h-[13px] w-[13px] shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
      >
        <CircularProgressbar
          value={percent}
          strokeWidth={11}
          className="h-full w-full align-middle"
          aria-hidden="true"
          styles={buildStyles({
            pathColor: "rgb(var(--color-ink-600))",
            trailColor: "rgb(var(--color-ink-300) / 0.6)",
            strokeLinecap: "round",
            pathTransitionDuration: 0.35,
          })}
        />
      </span>
    </Tooltip>
  );
}

function RuntimeUsageIndicator({ runtimeUsage }: { runtimeUsage?: RuntimeUsageSnapshot }): JSX.Element | null {
  return <ContextUsageIndicator usage={runtimeUsage?.contextUsage} />;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = attachments.find((entry) => entry.id === selectedId);
  const previewable = (entry: PendingAttachment): boolean =>
    Boolean(entry.file || entry.previewUrl) && entry.status !== "error";
  const activatePreview = (entry: PendingAttachment): void => {
    if (previewable(entry)) setSelectedId(entry.id);
  };

  return (
    <>
      <MotionList className={cn("flex flex-wrap gap-1.5 px-0.5 pb-1", attachments.length === 0 && "hidden")}>
        {attachments.map((entry) => (
          <MotionListItem
            key={entry.id}
            layout="position"
            initial={false}
            className={cn(
              entry.previewUrl && isImageFilePreview({ name: entry.fileName, mime: entry.mime }) && "shrink-0",
            )}
          >
            {entry.previewUrl && isImageFilePreview({ name: entry.fileName, mime: entry.mime }) ? (
              <div
                className={cn(
                  "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-surface-muted",
                  entry.status === "error" ? "border-brick-500" : "border-line-subtle",
                )}
                role={previewable(entry) ? "button" : undefined}
                tabIndex={previewable(entry) ? 0 : undefined}
                aria-label={
                  previewable(entry)
                    ? frontendMessage("chat.attachment.filePreview", { name: entry.fileName })
                    : undefined
                }
                onClick={() => activatePreview(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activatePreview(entry);
                  }
                }}
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
                      onClick={(event) => {
                        event.stopPropagation();
                        onRetry(entry.id);
                      }}
                      aria-label={frontendMessage("ui.retry")}
                      className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-brick-50 text-brick-600 transition hover:bg-brick-100"
                    >
                      <AppIcon icon="refresh" size={12} />
                    </button>
                  </Tooltip>
                ) : null}
                <IconButton
                  label={frontendMessage("chat.attachment.remove")}
                  tooltip={entry.error ?? frontendMessage("chat.attachment.removeTooltip")}
                  tooltipSide="top"
                  size="sm"
                  className="absolute right-0.5 top-0.5 bg-ink-950/70 text-paper-50 hover:bg-ink-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(entry.id);
                  }}
                >
                  <AppIcon icon="close" size={12} />
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
                role={previewable(entry) ? "button" : undefined}
                tabIndex={previewable(entry) ? 0 : undefined}
                aria-label={
                  previewable(entry)
                    ? frontendMessage("chat.attachment.filePreview", { name: entry.fileName })
                    : undefined
                }
                onClick={() => activatePreview(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activatePreview(entry);
                  }
                }}
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
                      <AppIcon icon="alert-circle" size={10} className="text-brick-500" />
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
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(entry.id);
                  }}
                >
                  <AppIcon icon="close" size={12} />
                </IconButton>
              </div>
            )}
          </MotionListItem>
        ))}
      </MotionList>
      {selected ? (
        <FilePreviewDialog
          file={selected.file}
          mime={selected.mime ?? selected.attachment?.mime}
          name={selected.fileName}
          size={selected.size}
          source={selected.previewUrl}
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedId(null);
            }
          }}
        />
      ) : null}
    </>
  );
}

function UploadProgressBar({ progress, className }: { progress?: UploadProgress; className?: string }): JSX.Element {
  const ratio = readProgressRatio(progress);
  return (
    <span className={cn("h-1 overflow-hidden rounded-full bg-surface-muted", className)}>
      <span
        className={cn(
          "block h-full origin-left rounded-full bg-accent-solid transition-transform duration-150",
          ratio === undefined && "senera-loading-pulse",
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
