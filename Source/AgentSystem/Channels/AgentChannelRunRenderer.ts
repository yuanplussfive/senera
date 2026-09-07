import { AgentEventKinds, type AgentEventKind } from "../Events/AgentEventCatalog.js";
import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentChannelAdapter, AgentChannelSource } from "./AgentChannelTypes.js";
import type { AgentChannelDelivery } from "./AgentChannelDelivery.js";
import type { AgentChannelFinalResponseRewriter } from "./AgentChannelFinalResponse.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import {
  agentChannelMediaIdentity,
  collectAgentChannelMarkdownResourceManifest,
  projectAgentChannelFinalParts,
  projectAgentChannelOutboundMedia,
} from "./AgentChannelOutboundMedia.js";
import type { AgentChannelOutboundMediaProjection, AgentChannelOutboundSegment } from "./AgentChannelOutboundMedia.js";
import type { AgentChannelFinalizationRecord } from "./AgentChannelFinalizationTypes.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import { requiresChannelFinalRewrite, splitChannelTextByParagraphs } from "./AgentChannelText.js";

export const AgentChannelRunRendererDefaults = Object.freeze({
  /** Throttle window for progressive edits (Telegram allows ~1 edit/s). */
  editIntervalMs: 800,
  /** Minimum accumulated delta before a throttled edit fires. */
  bufferThreshold: 24,
  /** Compact invocation line rendered when a tool starts. */
  toolProgressTemplate: (toolName: string) => agentErrorMessage("channels.renderer.toolProgress", { tool: toolName }),
  /** Maximum characters kept in the live preview; full text is delivered fresh. */
  previewLength: 3_000,
});

export interface AgentChannelRunRendererOptions {
  readonly adapter: AgentChannelAdapter;
  readonly delivery: AgentChannelDelivery;
  readonly source: AgentChannelSource;
  readonly streamProgress?: boolean;
  readonly editIntervalMs?: number;
  readonly bufferThreshold?: number;
  readonly previewLength?: number;
  readonly toolProgress?: (toolName: string) => string;
  /** Resolves canonical Senera resources before native media delivery. */
  readonly resourceResolver?: AgentResourceResolverLike;
  /** Host-owned serializer used for channel turns; absent only in legacy tests. */
  readonly finalResponseRewriter?: AgentChannelFinalResponseRewriter;
  /** Durable session identity used by the native serializer cache. */
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly logicalCacheScope?: string;
  /** Prior successful serializer projections for this channel session. */
  readonly finalizationHistory?: readonly AgentChannelFinalizationRecord[];
  readonly now?: () => Date;
  readonly onPreviewFailed?: (error: unknown) => void;
  readonly onMediaFailed?: (error: unknown) => void;
  readonly onFinalRewriteFailed?: (error: unknown) => void;
  readonly onFinalRewriteTiming?: AgentModelTimingSink;
  readonly onFinalizationPersistFailed?: (error: unknown) => void;
  readonly onFinalized?: (record: AgentChannelFinalizationRecord) => void | Promise<void>;
}

type RendererPhase = "idle" | "running" | "terminal";

/**
 * Renders the senera run event stream into one channel conversation lane.
 * Mirrors reference gateway stream consumers: model-authored prefaces are
 * delivered before tool calls, a throttled live preview is used only when the
 * platform supports edits, and the final answer settles as a separate message
 * whenever a preface was already delivered. There is intentionally no
 * synthetic "processing" placeholder: every visible line comes from a run
 * event or a compact tool invocation label.
 */
export class AgentChannelRunRenderer {
  readonly options: AgentChannelRunRendererOptions;
  private phase: RendererPhase = "idle";
  private previewMessageId?: string;
  private pendingPreview?: string;
  private lastEditAt = 0;
  private lastEditedLength = 0;
  private editTimer?: ReturnType<typeof setTimeout>;
  private finalAnswer?: string;
  private deliveredAssistantContents = new Set<string>();
  private deliveredMedia = new Set<string>();
  private disposed = false;
  private readonly finalizationAbortController = new AbortController();
  /** Serializes event handling even when the provider invokes its sink
   * concurrently. This keeps tool media, previews, and terminal answers in
   * the same order as the event stream. */
  private eventChain: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(options: AgentChannelRunRendererOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    if (options.editIntervalMs !== undefined && options.editIntervalMs < 0) {
      throw new Error("editIntervalMs must be non-negative.");
    }
    if (options.bufferThreshold !== undefined && options.bufferThreshold < 1) {
      throw new Error("bufferThreshold must be a positive integer.");
    }
  }

  async handleEvent(event: AgentDomainEvent): Promise<void> {
    if (this.disposed) return;
    const current = this.eventChain.then(() => (this.disposed ? undefined : this.handleEventInternal(event)));
    this.eventChain = current.catch(() => undefined);
    return current;
  }

  private async handleEventInternal(event: AgentDomainEvent): Promise<void> {
    switch (event.kind as AgentEventKind) {
      case AgentEventKinds.RunStarted:
        await this.onRunStarted();
        break;
      case AgentEventKinds.ModelDelta:
        await this.onModelDelta(event.data as { text?: string });
        break;
      case AgentEventKinds.ModelCompleted:
        if (this.options.streamProgress !== false) {
          await this.flushPreview();
        }
        break;
      case AgentEventKinds.ToolCallsPlanned:
        await this.onToolsPlanned(event.data as { toolCount?: number; reason?: string });
        break;
      case AgentEventKinds.ToolCallStarted:
        await this.onToolStarted(event.data as { toolName?: string; callId?: string });
        break;
      case AgentEventKinds.ToolCallResultDetail:
        await this.onToolResultDetail(event.data as { value?: unknown });
        break;
      case AgentEventKinds.ToolCallCompleted:
      case AgentEventKinds.ToolCallFailed:
        break;
      case AgentEventKinds.AssistantMessageCreated:
        await this.onAssistantMessage(
          event.data as { kind?: "tool_preface" | "final_answer" | "ask_user"; terminal?: boolean; content?: string },
        );
        break;
      case AgentEventKinds.RunCompleted:
        await this.finish();
        break;
      case AgentEventKinds.RunFailed:
        await this.fail(event.data as { message?: string });
        break;
      case AgentEventKinds.RunCancelled:
        await this.cancel();
        break;
      default:
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finalizationAbortController.abort();
    this.clearPreviewTimer();
  }

  private clearPreviewTimer(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = undefined;
  }

  private async onAssistantMessage(data: {
    kind?: "tool_preface" | "final_answer" | "ask_user";
    terminal?: boolean;
    content?: string;
  }): Promise<void> {
    const content = typeof data.content === "string" ? data.content : "";
    if (content.trim().length === 0) return;
    if (data.terminal === true) {
      this.finalAnswer = content;
      return;
    }
    if (data.kind === "tool_preface") {
      await this.publishToolPreface(content);
      return;
    }
    if (data.kind === "final_answer" || data.kind === "ask_user") {
      await this.publishAssistantPreview(content);
    }
  }

  private async onRunStarted(): Promise<void> {
    if (this.phase !== "idle") return;
    this.phase = "running";
  }

  private async onModelDelta(delta: { text?: string }): Promise<void> {
    if (this.phase !== "running" || this.options.streamProgress === false) return;
    const text = delta.text;
    if (typeof text !== "string" || text.length === 0) return;
    if (!this.options.adapter.capabilities.supportsEdit) return;

    this.pendingPreview = `${this.pendingPreview ?? ""}${text}`;
    if (!this.previewMessageId) {
      await this.ensurePreviewMessage();
      return;
    }
    if (this.pendingPreview.length - this.lastEditedLength < threshold(this.options.bufferThreshold)) {
      this.scheduleEdit();
      return;
    }
    await this.editPreviewNow();
  }

  private scheduleEdit(): void {
    if (this.editTimer || !this.previewMessageId) return;
    const interval = this.options.editIntervalMs ?? AgentChannelRunRendererDefaults.editIntervalMs;
    this.editTimer = setTimeout(() => {
      this.editTimer = undefined;
      void this.editPreviewNow().catch(() => undefined);
    }, interval);
    this.editTimer.unref?.();
  }

  private async editPreviewNow(): Promise<void> {
    if (!this.previewMessageId || !this.pendingPreview) return;
    const preview = this.pendingPreview;
    await this.editPreviewContent(preview);
  }

  private async editPreviewContent(content: string): Promise<boolean> {
    if (this.disposed || !this.previewMessageId || !this.options.adapter.capabilities.supportsEdit) return false;
    try {
      const result = await this.options.adapter.edit?.(
        this.options.source,
        this.previewMessageId,
        clampPreview(content, this.options.previewLength ?? AgentChannelRunRendererDefaults.previewLength),
      );
      if (result?.kind === "edited" || result?.kind === "sent") {
        this.lastEditedLength = content.length;
        this.lastEditAt = this.now().getTime();
        return true;
      }
    } catch (error) {
      this.reportPreviewFailure(error);
      // Fallback: the live preview is abandoned, the final answer is delivered
      // as a fresh message by finish().
    }
    return false;
  }

  private async flushPreview(): Promise<void> {
    if (!this.previewMessageId || !this.pendingPreview) return;
    const interval = this.options.editIntervalMs ?? AgentChannelRunRendererDefaults.editIntervalMs;
    if (this.now().getTime() - this.lastEditAt >= interval) {
      await this.editPreviewNow();
    } else {
      this.scheduleEdit();
    }
  }

  private async onToolsPlanned(data: { toolCount?: number; reason?: string }): Promise<void> {
    if (this.phase !== "running" || !data.toolCount || data.toolCount < 1) return;
    // Some producers can expose a tool batch without an AssistantMessageCreated
    // event. The planned reason is the model-authored preface in that case.
    const preface = data.reason?.trim() || this.pendingPreview?.trim();
    if (preface) await this.publishToolPreface(preface);
  }

  private async onToolStarted(_data: { toolName?: string; callId?: string }): Promise<void> {
    // Tool lifecycle events remain observable through the shared event sink;
    // they are never emitted as channel messages. The final response is the
    // only host delivery boundary for tool-produced work.
  }

  private async onToolResultDetail(_data: { value?: unknown }): Promise<void> {
    // Tool output is observable runtime state. Only assistant-authored
    // prefaces and final answers are eligible for channel delivery.
  }

  private async publishToolPreface(content: string): Promise<void> {
    const normalized = content.trim();
    if (!normalized || this.deliveredAssistantContents.has(normalized)) return;

    let delivered = false;
    if (this.previewMessageId && this.options.adapter.capabilities.supportsEdit) {
      delivered = await this.editPreviewContent(normalized);
      // A tool preface is durable context. Do not let the eventual final answer
      // overwrite it in the same editable message.
      this.disposePreviewMessage();
    }
    if (!delivered) delivered = this.options.delivery.enqueue(this.options.source, content);
    if (delivered) this.deliveredAssistantContents.add(normalized);
  }

  private async publishAssistantPreview(content: string): Promise<void> {
    if (this.phase !== "running" || this.options.streamProgress === false) return;
    const normalized = content.trim();
    if (!normalized) return;
    // A non-editable channel cannot reconcile a draft with the terminal
    // answer. Sending this event would expose the provider's intermediate
    // Markdown (often including media placeholders), then send the settled
    // answer again when RunCompleted arrives. The terminal assistant message
    // is the single durable delivery boundary for these channels.
    if (!this.options.adapter.capabilities.supportsEdit) {
      return;
    }
    if (!this.previewMessageId && this.deliveredAssistantContents.has(normalized)) return;
    this.pendingPreview = content;
    await this.ensurePreviewMessage();
    if (this.previewMessageId) await this.editPreviewNow();
  }

  private async ensurePreviewMessage(): Promise<void> {
    if (
      this.disposed ||
      !this.pendingPreview ||
      this.previewMessageId ||
      !this.options.adapter.capabilities.supportsEdit
    )
      return;
    try {
      const result = await this.options.adapter.send(
        this.options.source,
        clampPreview(this.pendingPreview, this.options.previewLength ?? AgentChannelRunRendererDefaults.previewLength),
      );
      if (result.kind === "sent") {
        this.previewMessageId = result.messageId;
        this.lastEditedLength = this.pendingPreview.length;
        this.lastEditAt = this.now().getTime();
      }
    } catch (error) {
      this.reportPreviewFailure(error);
    }
  }

  private disposePreviewMessage(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = undefined;
    this.previewMessageId = undefined;
    this.pendingPreview = undefined;
    this.lastEditedLength = 0;
  }

  private async finish(): Promise<void> {
    if (this.phase === "terminal") return;
    this.phase = "terminal";
    this.clearPreviewTimer();
    const final = this.finalAnswer;
    if (!final || final.trim().length === 0) {
      await this.deliverFinal(agentErrorMessage("channels.renderer.done"));
      return;
    }
    await this.deliverFinal(final);
  }

  private async fail(data: { message?: string }): Promise<void> {
    if (this.phase === "terminal") return;
    this.phase = "terminal";
    this.clearPreviewTimer();
    const message =
      typeof data.message === "string" && data.message.length > 0
        ? data.message
        : agentErrorMessage("channels.renderer.failedFallback");
    await this.deliverFinal(agentErrorMessage("channels.renderer.failed", { message }));
  }

  private async cancel(): Promise<void> {
    if (this.phase === "terminal") return;
    this.phase = "terminal";
    this.clearPreviewTimer();
    await this.deliverFinal(agentErrorMessage("channels.renderer.cancelled"));
  }

  /**
   * Delivers a settled answer without requiring a live run event stream.
   * Scheduled and resident notifications use this same projection boundary so
   * they preserve channel media ordering and the final-response rewrite rules.
   */
  async deliverProactive(content: string): Promise<boolean> {
    if (this.disposed) return false;
    return this.deliverFinal(content);
  }

  private async deliverFinal(content: string): Promise<boolean> {
    if (this.disposed) return false;
    const rewriter = this.options.finalResponseRewriter;
    const requiresRewrite = requiresChannelFinalRewrite(content);
    // Keep the cheap, deterministic path for ordinary prose. The native
    // serializer is reserved for payloads whose resource/code boundaries
    // cannot be recovered safely by the local projector.
    if (rewriter && requiresRewrite) {
      try {
        let resourceManifest;
        try {
          resourceManifest = await collectAgentChannelMarkdownResourceManifest(content, {
            resourceResolver: this.options.resourceResolver,
          });
        } catch {
          // The serializer can still preserve the original answer when a
          // malformed Markdown block prevents manifest extraction.
          resourceManifest = undefined;
        }
        const delivery = await rewriter.rewrite({
          content,
          source: this.options.source,
          requestId: this.options.requestId,
          sessionId: this.options.sessionId,
          logicalCacheScope: this.options.logicalCacheScope,
          timingSink: this.options.onFinalRewriteTiming,
          signal: this.finalizationAbortController.signal,
          context: {
            ...(resourceManifest ? { resourceManifest } : {}),
            history: this.options.finalizationHistory ?? [],
          },
        });
        if (this.disposed) return false;
        const projection = await projectAgentChannelFinalParts(delivery.parts, {
          resourceResolver: this.options.resourceResolver,
        });
        if (this.disposed) return false;
        if (projection.segments.length > 0 || projection.caption.trim().length > 0) {
          const accepted = await this.deliverFinalProjection(projection);
          if (accepted) await this.persistFinalization(content, delivery.parts, resourceManifest);
          return accepted;
        }
        // An empty projection (e.g. whitespace-only parts) must not swallow
        // the answer; fall through to the plain-text delivery path below.
      } catch (error) {
        this.options.onFinalRewriteFailed?.(error);
      }
    }
    if (this.options.adapter.capabilities.supportsMedia === true) {
      try {
        const projection = await projectAgentChannelOutboundMedia(content, {
          resourceResolver: this.options.resourceResolver,
        });
        if (projection.media.length > 0) {
          return this.deliverFinalProjection(projection);
        }
      } catch (error) {
        this.reportMediaFailure(error);
      }
    }
    if (this.previewMessageId && this.options.adapter.capabilities.supportsEdit) {
      const previewLength = this.options.previewLength ?? AgentChannelRunRendererDefaults.previewLength;
      const preview = clampPreview(content, previewLength);
      try {
        const edited = await this.options.adapter.edit?.(this.options.source, this.previewMessageId, preview);
        if (edited?.kind === "edited" || edited?.kind === "sent") {
          if (content.length > previewLength) {
            this.disposePreviewMessage();
            return this.enqueueText(content, previewLength);
          }
          return true;
        }
      } catch (error) {
        this.reportPreviewFailure(error);
      }
    }
    if (!this.previewMessageId && !this.deliveredAssistantContents.has(content.trim())) {
      // Preserve fenced/resource syntax as one text payload when the model
      // serializer produced no usable parts; paragraph splitting would break
      // a code fence into unrelated messages.
      return requiresChannelFinalRewrite(content) ? this.enqueueText(content) : this.enqueueTextByParagraphs(content);
    }
    return true;
  }

  private async deliverFinalProjection(projection: AgentChannelOutboundMediaProjection): Promise<boolean> {
    if (this.disposed) return false;
    const segments =
      projection.segments.length > 0
        ? projection.segments
        : projection.caption.trim()
          ? ([{ kind: "text", content: projection.caption }] satisfies AgentChannelOutboundSegment[])
          : [];
    const previewMessageId = this.previewMessageId;
    const hadPreview = Boolean(previewMessageId && this.options.adapter.capabilities.supportsEdit);
    let consumedTextIndex = -1;
    let consumedTextLength = 0;
    if (hadPreview) {
      const firstText = segments.findIndex((segment) => segment.kind === "text");
      const previewCaption =
        firstText >= 0 && segments[firstText]?.kind === "text" ? segments[firstText].content : "图片";
      try {
        const edited = await this.options.adapter.edit?.(
          this.options.source,
          previewMessageId!,
          clampPreview(previewCaption, this.options.previewLength ?? AgentChannelRunRendererDefaults.previewLength),
        );
        if (edited?.kind === "edited" || edited?.kind === "sent") {
          consumedTextIndex = firstText;
          consumedTextLength = Math.min(
            previewCaption.length,
            this.options.previewLength ?? AgentChannelRunRendererDefaults.previewLength,
          );
          this.disposePreviewMessage();
        }
      } catch (error) {
        this.reportPreviewFailure(error);
      }
    }

    let accepted = true;
    for (let index = 0; index < segments.length; index += 1) {
      if (this.disposed) return false;
      const segment = segments[index];
      if (segment.kind === "text") {
        const skip = index === consumedTextIndex ? consumedTextLength : 0;
        accepted = (await this.enqueueText(segment.content, skip)) && accepted;
        continue;
      }
      const key = agentChannelMediaIdentity(segment.media);
      if (this.deliveredMedia.has(key)) continue;
      this.deliveredMedia.add(key);
      const queued = this.options.delivery.enqueue(this.options.source, "", {
        chatType: this.options.source.chatType,
        media: [segment.media],
      });
      if (!queued) {
        this.deliveredMedia.delete(key);
        accepted = false;
      }
    }
    return accepted;
  }

  private async persistFinalization(
    content: string,
    parts: readonly import("./AgentChannelOutboundMedia.js").AgentChannelFinalPart[],
    resourceManifest: import("./AgentChannelOutboundMedia.js").AgentChannelMarkdownResourceManifest | undefined,
  ): Promise<void> {
    if (!this.options.onFinalized) return;
    const record: AgentChannelFinalizationRecord = {
      id: this.options.requestId?.trim() || createOpaqueId("channel_finalization"),
      ...(this.options.requestId?.trim() ? { requestId: this.options.requestId.trim() } : {}),
      createdAt: this.now().toISOString(),
      platform: this.options.source.platform,
      chatType: this.options.source.chatType,
      ...(this.options.logicalCacheScope ? { logicalCacheScope: this.options.logicalCacheScope } : {}),
      content,
      parts,
      ...(resourceManifest ? { resourceManifest } : {}),
    };
    try {
      await this.options.onFinalized(record);
    } catch (error) {
      this.options.onFinalizationPersistFailed?.(error);
    }
  }

  private async enqueueText(content: string, skipPrefixLength = 0): Promise<boolean> {
    if (this.disposed) return false;
    if (!content.trim()) return true;
    const { splitAgentChannelContent } = await import("./AgentChannelText.js");
    const max = this.options.adapter.capabilities.maxMessageLength;
    const payload = skipPrefixLength > 0 ? content.slice(skipPrefixLength) : content;
    const pending = this.options.adapter.capabilities.splitsLongMessages
      ? splitAgentChannelContent(payload, max)
      : [payload];
    let accepted = true;
    for (const chunk of pending) {
      if (this.disposed) return false;
      if (chunk.trim() && this.options.delivery.enqueue(this.options.source, chunk)) {
        this.deliveredAssistantContents.add(chunk.trim());
      } else if (chunk.trim()) {
        accepted = false;
      }
    }
    return accepted;
  }

  private async enqueueTextByParagraphs(content: string, skipPrefixLength = 0): Promise<boolean> {
    if (this.disposed) return false;
    if (!content.trim()) return true;
    const payload = skipPrefixLength > 0 ? content.slice(skipPrefixLength) : content;
    const paragraphs = splitChannelTextByParagraphs(payload, 4);
    let accepted = true;
    for (const paragraph of paragraphs) {
      if (this.disposed) return false;
      accepted = (await this.enqueueText(paragraph)) && accepted;
    }
    return accepted;
  }

  private reportPreviewFailure(error: unknown): void {
    this.options.onPreviewFailed?.(error);
  }

  private reportMediaFailure(error: unknown): void {
    this.options.onMediaFailed?.(error);
  }
}

function clampPreview(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}\n…`;
}

function threshold(value: number | undefined): number {
  const resolved = value ?? AgentChannelRunRendererDefaults.bufferThreshold;
  return resolved < 1 ? 1 : resolved;
}
