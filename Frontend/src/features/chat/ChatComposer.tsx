import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { UploadAttachmentData } from "../../api/eventTypes";
import type {
  AgentActivationCatalogSnapshot,
  ExplicitActivationReference,
  ExplicitActivationSet,
  SandboxStatusSnapshotData,
} from "../../api/eventTypes";
import { ExecutionContextChip } from "../../shared/workspace/ExecutionContextChip";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendChatMessage } from "../../i18n/frontendChatMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { useResponsiveMode } from "../../shared/responsive";
import { MotionButton } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ConversationFrame,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Tooltip,
  AppIcon,
} from "../../shared/ui";
import { ChatModelSelector } from "./ChatModelSelector";
import { composerControlClassName, composerIconControlClassName } from "./composerControls";
import { AgentMenu } from "../agents/AgentMenu";
import { AgentSettingsDialog } from "../agents/AgentSettingsDialog";
import { useStore } from "../../store/sessionStore";
import { readConversationAgent } from "../../store/session/sessionAgentSelection";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { ChatApprovalConfig, ChatModelConfig } from "./ChatPanelContracts";
import { useComposerAttachments } from "./useComposerAttachments";
import { ComposerAttachmentTray } from "./ComposerAttachmentTray";
import type { RuntimeContextUsage, RuntimeUsageSnapshot } from "../observability/runtimeDiagnosticProjection";
import {
  ActivationPalette,
  ActivationTextOverlay,
  activationOptionId,
  rankActivationCandidates,
  readActivationQuery,
  readActivationRange,
  readActivationTokens,
  stepActivationIndex,
} from "./ChatActivationPalette";

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
  /** Cancellation is queued across a transient socket reconnect, so it has a
   * separate disabled state from ordinary message submission. */
  cancelDisabled: boolean;
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
    sandboxStatus?: SandboxStatusSnapshotData | null;
  };
  runtimeUsage?: RuntimeUsageSnapshot;
  onSend: (
    input: string,
    attachments?: UploadAttachmentData[],
    queueMode?: MessageQueueMode,
    activations?: ExplicitActivationSet,
  ) => boolean | Promise<boolean>;
  onCancel: () => void;
  activationCatalog?: AgentActivationCatalogSnapshot | null;
}

export const ChatComposer = memo(function ChatComposer({
  disabled,
  cancelDisabled,
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
  activationCatalog,
}: ChatComposerProps): JSX.Element {
  const locale = useFrontendLocale();
  const [internalValue, setInternalValue] = useState("");
  const submitting = useRef(false);
  const [sending, setSending] = useState(false);
  const currentDraft = useRef({ key: runtime.draftKey, value: controlledValue ?? internalValue });
  currentDraft.current = { key: runtime.draftKey, value: controlledValue ?? internalValue };
  const value = controlledValue ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const textOverlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAgentManagementRef = useRef(false);
  const [agentManagementOpen, setAgentManagementOpen] = useState(false);
  const activeAgent = useStore(readConversationAgent);
  const [toolkitOpen, setToolkitOpen] = useState(false);
  const [activationSelection, setActivationSelection] = useState<ExplicitActivationReference[]>([]);
  const [activationQuery, setActivationQuery] = useState<string | null>(null);
  const [activationIndex, setActivationIndex] = useState(0);
  const activationListId = useId();
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
    return registerReferenceHandler?.((file) => attachmentHandler.current([file]));
  }, [registerReferenceHandler]);
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;
  const showActivationOverlay = activationSelection.length > 0;

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

  const canSend =
    !disabled &&
    !sending &&
    !attachments.restoring &&
    attachments.pendingAttachments.every((entry) => entry.status === "uploaded") &&
    (value.trim().length > 0 || attachments.pendingAttachments.length > 0);
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
    if (toolkitOpen || !pendingAgentManagementRef.current) return;
    pendingAgentManagementRef.current = false;
    setAgentManagementOpen(true);
  }, [toolkitOpen]);

  useEffect(() => {
    setActivationSelection([]);
    setActivationQuery(null);
    setActivationIndex(0);
  }, [runtime.draftKey]);

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
    const token = readActivationRange(value, caret);
    if (!token) return;
    const suffix = value.slice(token.end);
    const separator = /^\s/u.test(suffix) ? "" : " ";
    const nextValue = `${value.slice(0, token.start)}@${candidate.id}${separator}${suffix}`;
    const referencedIds = new Set(readActivationTokens(nextValue));
    setValue(nextValue);
    setActivationSelection((current) => [
      ...current.filter(
        (entry) => referencedIds.has(entry.id) && (entry.kind !== candidate.kind || entry.id !== candidate.id),
      ),
      { kind: candidate.kind, id: candidate.id, revision: candidate.revision },
    ]);
    setActivationQuery(null);
    setActivationIndex(0);
    requestAnimationFrame(() => {
      const nextCaret = token.start + candidate.id.length + 2;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const submit = async (queueMode?: MessageQueueMode): Promise<void> => {
    const text = value.trim();
    if (!canSend || submitting.current) return;
    const stale = activationSelection.filter(
      (selection) =>
        !activationCatalog?.entries.some(
          (entry) =>
            entry.kind === selection.kind &&
            entry.id === selection.id &&
            entry.revision === selection.revision &&
            entry.selectable,
        ),
    );
    if (stale.length > 0) {
      toast.error(
        frontendChatMessage(
          "chat.composer.activation.changed",
          { names: stale.map((entry) => `@${entry.id}`).join(", ") },
          locale,
        ),
      );
      return;
    }
    const uploaded = attachments.collectUploadedAttachments();
    const activations: ExplicitActivationSet | undefined =
      activationSelection.length > 0 && activationCatalog
        ? { catalogRevision: activationCatalog.revision, explicit: activationSelection }
        : undefined;
    const draft = currentDraft.current;
    submitting.current = true;
    setSending(true);
    const releaseDraft = attachments.retain();
    let sent: boolean;
    try {
      sent = await (activations
        ? onSend(text, uploaded.length > 0 ? uploaded : undefined, queueMode, activations)
        : onSend(text, uploaded.length > 0 ? uploaded : undefined, queueMode));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("chat.sendUnconfirmed"));
      return;
    } finally {
      submitting.current = false;
      setSending(false);
      releaseDraft();
    }
    if (sent === false) return;
    attachments.commitSentAttachments();
    // Acknowledgement can arrive after switching conversations or typing the next message.
    if (currentDraft.current.key === draft.key && currentDraft.current.value !== draft.value) return;
    setValue("");
    if (currentDraft.current.key !== draft.key) return;
    setActivationSelection([]);
    setActivationQuery(null);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (activationQuery !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        setActivationQuery(null);
        return;
      }
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
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (composerAction === "cancel" || composerAction === "cancelling") return;
      void submit(
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
        void submit("follow_up");
        return;
      case "steer":
        void submit("steer");
        return;
      case "send":
        void submit();
        return;
    }
  };

  return (
    <div className="bg-transparent pb-6 pt-4">
      <ConversationFrame mode="composer">
        <div
          onDragEnter={attachments.handleDragEnter}
          onDragOver={attachments.handleDragOver}
          onDragLeave={attachments.handleDragLeave}
          onDrop={attachments.handleDrop}
          className={cn(
            "relative flex min-w-0 flex-col gap-2 rounded-2xl border border-line-subtle bg-surface-raised px-4 pb-3 pt-3.5 shadow-[0_12px_32px_-16px_rgb(43_40_32_/_0.10)] transition-[background-color,border-color,box-shadow] duration-150",
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
          <ComposerAttachmentTray
            attachments={attachments.pendingAttachments}
            onRemove={attachments.removeAttachment}
            onRetry={attachments.retryAttachment}
            onPreviewUnavailable={attachments.markPreviewUnavailable}
          />

          <div className="relative min-h-10">
            {showActivationOverlay ? (
              <ActivationTextOverlay ref={textOverlayRef} value={value} selected={activationSelection} />
            ) : null}
            <textarea
              ref={taRef}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={activationQuery !== null && activationCanSelect}
              aria-controls={activationQuery !== null && activationCanSelect ? activationListId : undefined}
              aria-activedescendant={
                activationQuery !== null && activationCanSelect && activationCandidates[activationIndex]
                  ? activationOptionId(activationListId, activationCandidates[activationIndex])
                  : undefined
              }
              aria-label={frontendMessage("chat.composer.inputMessage")}
              value={value}
              rows={1}
              onChange={handleInput}
              onSelect={(event) => {
                const textarea = event.currentTarget;
                setActivationQuery(
                  activationCanSelect && textarea.selectionStart === textarea.selectionEnd
                    ? readActivationQuery(textarea.value, textarea.selectionStart)
                    : null,
                );
              }}
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
                "scrollbar-thin relative z-[1] block min-h-10 w-full resize-none bg-transparent px-1 py-2 font-sans text-[14px] leading-5 caret-accent-content selection:bg-accent-surface selection:text-content-primary placeholder:text-content-disabled focus:outline-none disabled:opacity-60",
                showActivationOverlay ? "text-transparent" : "text-content-primary",
              )}
            />
          </div>
          {activationQuery !== null && activationCanSelect ? (
            <ActivationPalette
              id={activationListId}
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
            <div className="flex shrink-0 items-center gap-1">
              <DropdownMenu modal={false} open={toolkitOpen} onOpenChange={setToolkitOpen}>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label={frontendChatMessage("chat.composer.toolkit.tooltip")}
                    tooltip={frontendChatMessage("chat.composer.toolkit.tooltip")}
                    tooltipSide="top"
                    touchSafe
                    className={cn(
                      composerIconControlClassName(prefersCompactControls),
                      "[&[data-state=open]>svg]:rotate-45",
                    )}
                  >
                    <AppIcon
                      icon="plus"
                      size={16}
                      className="transition-transform duration-[var(--icon-rotate-dur)] ease-[var(--icon-rotate-ease)]"
                    />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={6} alignOffset={6} className="w-64">
                  <DropdownMenuItem
                    icon={<AppIcon icon="paperclip" size={16} />}
                    disabled={disabled || running || cancelling}
                    onSelect={() => fileInputRef.current?.click()}
                  >
                    {frontendChatMessage("chat.composer.toolkit.fileAndImage")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <AgentMenu
                    disabled={disabled || running || cancelling}
                    onManage={() => {
                      pendingAgentManagementRef.current = true;
                    }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
              <ExecutionContextChip
                sandboxStatus={runtime.sandboxStatus}
                approval={{
                  mode: approvalConfig.mode,
                  disabled: disabled || running || cancelling,
                  onSelect: approvalConfig.onSelectMode,
                }}
                prefersCompactControls={prefersCompactControls}
              />
            </div>

            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1" data-composer-trailing-controls>
              <RuntimeUsageIndicator runtimeUsage={runtimeUsage} />
              <ChatModelSelector
                disabled={disabled || running}
                models={modelConfig.modelProviders}
                selectedId={modelConfig.selectedModelProviderId}
                defaultModelId={modelConfig.defaultModelProviderId}
                selectedThinkingLevel={modelConfig.selectedThinkingLevel}
                onSelect={modelConfig.onSelectModelProvider}
                onSelectThinkingLevel={modelConfig.onSelectThinkingLevel}
                prefersCompactControls={prefersCompactControls}
              />
              {composerAction === "cancelling" ? (
                <Tooltip content={frontendMessage("chat.composer.cancelling")} side="top">
                  <MotionButton
                    disabled
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-content-muted",
                      composerIconControlClassName(prefersCompactControls),
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
                    disabled={cancelDisabled}
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-lg border border-brick-200 bg-surface-raised text-brick-600 transition-colors duration-150 hover:bg-brick-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick-200 disabled:pointer-events-none disabled:opacity-50",
                      composerIconControlClassName(prefersCompactControls),
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
                      "inline-flex shrink-0 items-center justify-center rounded-full border-0 transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-chat-composer-focus-bg)] disabled:pointer-events-none",
                      composerIconControlClassName(prefersCompactControls),
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
      {agentManagementOpen && activeAgent ? (
        <AgentSettingsDialog open onOpenChange={setAgentManagementOpen} initialId={activeAgent.id} />
      ) : null}
    </div>
  );
});

const CONTEXT_USAGE_METER_CELLS = 18;
const CONTEXT_USAGE_WARN_PERCENT = 60;
const CONTEXT_USAGE_CRITICAL_PERCENT = 85;

function ContextUsageIndicator({ usage }: { usage?: RuntimeContextUsage }): JSX.Element | null {
  const locale = useFrontendLocale();
  const { prefersCompactControls } = useResponsiveMode();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) clearTimeout(closeTimer.current);
    },
    [],
  );

  const hasTokens = typeof usage?.tokens === "number" && Number.isFinite(usage.tokens);
  const hasContextWindow = typeof usage?.contextWindow === "number" && Number.isFinite(usage.contextWindow);
  if (!usage || !hasTokens || !hasContextWindow || usage.contextWindow <= 0) return null;

  const used = Math.max(0, usage.tokens);
  const percent = Math.max(0, Math.min(100, usage.percent ?? (used / usage.contextWindow) * 100));
  const roundedPercent = Math.round(percent);
  const remaining = Math.max(0, usage.contextWindow - used);
  const warn = percent >= CONTEXT_USAGE_WARN_PERCENT;
  const critical = percent >= CONTEXT_USAGE_CRITICAL_PERCENT;
  const meterColor = critical
    ? "rgb(var(--color-brick-600))"
    : warn
      ? "rgb(var(--color-brick-500))"
      : "rgb(var(--color-ink-600))";
  const activeCells = Math.round((percent / 100) * CONTEXT_USAGE_METER_CELLS);
  const numberFormat = new Intl.NumberFormat(locale);

  const compactHidden = prefersCompactControls && percent < CONTEXT_USAGE_WARN_PERCENT;
  if (compactHidden) return null;

  const cancelClose = (): void => {
    if (closeTimer.current === undefined) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };

  const reveal = (): void => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      closeTimer.current = undefined;
    }, 160);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={frontendMessage(
            "chat.composer.contextUsageSummary",
            { used: roundedPercent, remaining: Math.max(0, 100 - roundedPercent) },
            locale,
          )}
          data-context-usage-indicator
          data-level={critical ? "critical" : warn ? "warn" : "normal"}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") reveal();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") scheduleClose();
          }}
          className={cn(
            "group inline-flex shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            composerControlClassName(prefersCompactControls),
            prefersCompactControls && "min-w-11",
          )}
        >
          <span
            className={cn(
              "inline-flex items-center",
              prefersCompactControls
                ? cn(
                    critical
                      ? "h-6 rounded-[7px] px-2 bg-[linear-gradient(180deg,rgb(var(--color-paper-50)/0.86),rgb(var(--color-brick-50)/0.72))] shadow-[0_0_0_1px_rgb(var(--color-brick-500)/0.28),0_1px_2px_rgb(var(--color-ink-950)/0.05),inset_0_1px_0_rgb(var(--color-paper-50)/0.9)] backdrop-blur-[8px] backdrop-saturate-[1.08]"
                      : "px-1",
                  )
                : "h-full gap-2 rounded-lg px-2 bg-[linear-gradient(180deg,rgb(var(--color-paper-50)/0.82),rgb(var(--color-paper-100)/0.58))] shadow-[0_0_0_1px_rgb(var(--color-ink-950)/0.07),0_1px_2px_rgb(var(--color-ink-950)/0.05),inset_0_1px_0_rgb(var(--color-paper-50)/0.9)] backdrop-blur-[8px] backdrop-saturate-[1.08] transition-[background,box-shadow] duration-150 group-hover:bg-[linear-gradient(180deg,rgb(var(--color-paper-50)/0.96),rgb(var(--color-paper-100)/0.76))] group-hover:shadow-[0_0_0_1px_rgb(var(--color-ink-950)/0.1),0_2px_4px_rgb(var(--color-ink-950)/0.06),inset_0_1px_0_rgb(var(--color-paper-50)/0.95)] group-data-[state=open]:bg-[linear-gradient(180deg,rgb(var(--color-paper-50)/0.96),rgb(var(--color-paper-100)/0.76))]",
            )}
          >
            <span
              className={cn(
                "inline-flex items-baseline gap-px font-mono text-[10.5px] font-medium leading-none tabular-nums tracking-[0.02em]",
                critical ? "text-brick-700" : warn ? "text-brick-600" : "text-ink-600",
              )}
            >
              {roundedPercent}
              <i className="text-[8.5px] font-normal not-italic text-ink-400">%</i>
            </span>
            {prefersCompactControls ? null : (
              <span aria-hidden="true" className="block h-[3px] w-6 overflow-hidden rounded-full bg-ink-900/10">
                <span
                  className="block h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{ width: `${percent}%`, backgroundColor: meterColor }}
                />
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        collisionPadding={12}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") cancelClose();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") scheduleClose();
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        data-context-usage-popover
        className={cn(
          "w-[244px] overflow-visible rounded-xl border-0 p-0",
          "bg-[linear-gradient(180deg,rgb(var(--color-paper-50)/0.9),rgb(var(--color-paper-100)/0.76))]",
          "shadow-[0_0_0_1px_rgb(var(--color-ink-950)/0.09),0_16px_36px_rgb(var(--color-ink-950)/0.16),inset_0_1px_0_rgb(var(--color-paper-50)/0.95)]",
          "backdrop-blur-[18px] backdrop-saturate-[1.16]",
        )}
      >
        <div className="px-3 pb-3 pt-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] tracking-[0.06em] text-content-muted">
              {frontendMessage("chat.composer.contextUsage", {}, locale)}
            </span>
            <span className="font-mono text-[9px] tracking-[0.04em] text-content-disabled">
              CTX / {formatComposerTokenCount(usage.contextWindow).toUpperCase()}
            </span>
          </div>
          <div className="mb-2 mt-1.5 flex items-baseline gap-1.5">
            <b
              className={cn(
                "font-mono text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
                warn ? "text-brick-600" : "text-content-strong",
              )}
            >
              {roundedPercent}
              <i className="text-[11px] font-medium not-italic text-content-muted">%</i>
            </b>
            <span className="text-[10px] text-content-muted">
              {frontendMessage("chat.composer.contextUsageUsed", {}, locale)}
            </span>
          </div>
          <div className="mb-2.5 flex h-3 items-end gap-[2px]" aria-hidden="true">
            {Array.from({ length: CONTEXT_USAGE_METER_CELLS }, (_, index) => (
              <i
                key={index}
                className={cn(
                  "block flex-1 rounded-[1px] transition-[background-color,height] duration-200",
                  index < activeCells ? "h-2.5" : "h-[7px] bg-ink-900/10",
                )}
                style={index < activeCells ? { backgroundColor: meterColor } : undefined}
              />
            ))}
          </div>
          <dl className="flex flex-col gap-1 text-[10px]">
            <div className="flex items-baseline justify-between gap-2.5 text-content-muted">
              <dt>{frontendMessage("chat.composer.contextUsageUsed", {}, locale)}</dt>
              <dd className="font-mono font-medium tabular-nums text-content-primary">{numberFormat.format(used)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2.5 text-content-muted">
              <dt>{frontendMessage("chat.composer.contextUsageRemaining", {}, locale)}</dt>
              <dd className="font-mono font-medium tabular-nums text-content-primary">
                {numberFormat.format(remaining)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2.5 text-content-muted">
              <dt>{frontendMessage("chat.composer.contextUsageWindow", {}, locale)}</dt>
              <dd className="font-mono font-medium tabular-nums text-content-primary">
                {numberFormat.format(usage.contextWindow)}
              </dd>
            </div>
          </dl>
          <div className="my-[9px] h-px bg-ink-900/[0.07]" />
          <p className="m-0 text-[9.5px] leading-[1.5] text-content-muted">
            {frontendMessage("chat.composer.contextUsageHint", {}, locale)}
          </p>
        </div>
      </PopoverContent>
    </Popover>
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
