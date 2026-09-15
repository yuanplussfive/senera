import { AgentEventKinds, type AgentEventKind } from "../Events/AgentEventCatalog.js";
import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentChannelAdapter, AgentChannelMedia, AgentChannelSource } from "./AgentChannelTypes.js";
import type { AgentChannelDelivery } from "./AgentChannelDelivery.js";
import type { AgentChannelFinalResponseRewriter } from "./AgentChannelFinalResponse.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import {
  agentChannelMediaIdentity,
  collectAgentChannelMarkdownResourceManifest,
  projectAgentChannelFinalParts,
} from "./AgentChannelOutboundMedia.js";
import type {
  AgentChannelFinalPart,
  AgentChannelOutboundMediaProjection,
  AgentChannelOutboundSegment,
} from "./AgentChannelOutboundMedia.js";
import {
  createAgentChannelActivity,
  type AgentChannelActivity,
  type AgentChannelActivityPart,
  type AgentChannelActivityDeliveryReceipt,
} from "./AgentChannelActivity.js";
import type { AgentChannelFinalizationRecord } from "./AgentChannelFinalizationTypes.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import {
  analyzeChannelMarkdownStructure,
  splitAgentChannelContent,
  splitChannelTextByParagraphs,
} from "./AgentChannelText.js";
import {
  packAgentChannelFinalTextParts,
  type AgentChannelFinalTextPackingPolicy,
} from "./AgentChannelFinalTextPacking.js";

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
  /** Host-owned serializer used for every settled channel answer. */
  readonly finalResponseRewriter?: AgentChannelFinalResponseRewriter;
  /** Durable session identity used by the native serializer cache. */
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly logicalCacheScope?: string;
  /** Prior successful serializer projections for this channel session. */
  readonly finalizationHistory?: readonly AgentChannelFinalizationRecord[];
  /** Transport grouping for adjacent prose; media and code remain boundaries. */
  readonly finalTextPacking?: AgentChannelFinalTextPackingPolicy;
  readonly now?: () => Date;
  readonly onPreviewFailed?: (error: unknown) => void;
  readonly onDeliveryFailed?: (error: unknown) => void;
  readonly onFinalRewriteFailed?: (error: unknown) => void;
  readonly onFinalRewriteTiming?: AgentModelTimingSink;
  readonly onFinalizationPersistFailed?: (error: unknown) => void;
  readonly onFinalized?: (record: AgentChannelFinalizationRecord) => void | Promise<void>;
}

type RendererPhase = "idle" | "running" | "terminal";

type AgentChannelFinalDeliveryIntent =
  { readonly kind: "assistant_final" } | { readonly kind: "proactive" } | { readonly kind: "host_notice" };

const AssistantFinalDelivery: AgentChannelFinalDeliveryIntent = Object.freeze({ kind: "assistant_final" });
const ProactiveDelivery: AgentChannelFinalDeliveryIntent = Object.freeze({ kind: "proactive" });
const HostNoticeDelivery: AgentChannelFinalDeliveryIntent = Object.freeze({ kind: "host_notice" });

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
  private deliveryFailureReported = false;
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
    if (!delivered) {
      const receipt = await this.options.delivery.enqueueAndWait(this.options.source, content);
      delivered = receipt.status === "sent";
      if (receipt.status === "failed") this.reportDeliveryFailure(receipt.error);
    }
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
      await this.deliverFinal(agentErrorMessage("channels.renderer.done"), HostNoticeDelivery);
      return;
    }
    await this.deliverFinal(final, AssistantFinalDelivery);
  }

  private async fail(data: { message?: string }): Promise<void> {
    if (this.phase === "terminal") return;
    this.phase = "terminal";
    this.clearPreviewTimer();
    const message =
      typeof data.message === "string" && data.message.length > 0
        ? data.message
        : agentErrorMessage("channels.renderer.failedFallback");
    await this.deliverFinal(agentErrorMessage("channels.renderer.failed", { message }), HostNoticeDelivery);
  }

  private async cancel(): Promise<void> {
    if (this.phase === "terminal") return;
    this.phase = "terminal";
    this.clearPreviewTimer();
    await this.deliverFinal(agentErrorMessage("channels.renderer.cancelled"), HostNoticeDelivery);
  }

  /**
   * Delivers a settled answer without requiring a live run event stream.
   * Scheduled and resident notifications use this same projection boundary so
   * they preserve channel media ordering and the final-response rewrite rules.
   */
  async deliverProactive(content: string): Promise<boolean> {
    if (this.disposed) return false;
    return this.deliverFinal(content, ProactiveDelivery);
  }

  /** Delivers an already structured activity without Markdown inference. */
  async deliverActivity(activity: AgentChannelActivity): Promise<boolean> {
    const receipt = await this.publishActivity(activity);
    return receipt.status === "sent";
  }

  /** Publishes a structured activity and returns a bounded delivery receipt. */
  async publishActivity(activity: AgentChannelActivity): Promise<AgentChannelActivityDeliveryReceipt> {
    if (
      this.disposed ||
      activity.source.platform !== this.options.source.platform ||
      activity.source.chatType !== this.options.source.chatType ||
      activity.source.chatId !== this.options.source.chatId ||
      activity.source.userId !== this.options.source.userId ||
      activity.source.threadId !== this.options.source.threadId
    )
      return {
        status: "failed",
        activityId: activity.activityId,
        messageIds: [],
        parts: [],
      };
    const selectedResources = new Set(
      activity.publication.mode === "current_turn" ? activity.publication.resourceUris : [],
    );
    const parts = activity.parts.filter(
      (part) =>
        part.kind === "text" ||
        (activity.publication.mode === "current_turn" &&
          (part.media.resourceUri === undefined || selectedResources.has(part.media.resourceUri))),
    );
    const delivery = await this.deliverActivityPartsWithReceipt(parts);
    const receipt: AgentChannelActivityDeliveryReceipt = {
      status: delivery.accepted ? "sent" : delivery.parts.some((part) => part.status === "sent") ? "partial" : "failed",
      activityId: activity.activityId,
      messageIds: delivery.parts.flatMap((part) => part.messageIds),
      parts: delivery.parts,
    };
    return receipt;
  }

  private async deliverFinal(content: string, intent: AgentChannelFinalDeliveryIntent): Promise<boolean> {
    if (this.disposed) return false;
    const rewriter = this.options.finalResponseRewriter;
    // Resource selection is driven by the parsed manifest. A tool result alone
    // never enters this path, so merely creating an Artifact cannot publish it.
    const structure = analyzeChannelMarkdownStructure(content);
    const needsResourceManifest =
      structure.mediaReferenceCount > 0 || structure.resourceLinkCount > 0 || structure.inlineResourceUriCount > 0;
    const resourceManifest =
      intent.kind !== "host_notice" && needsResourceManifest
        ? await collectAgentChannelMarkdownResourceManifest(content, {
            resourceResolver: this.options.resourceResolver,
          }).catch(() => undefined)
        : undefined;
    // Every settled assistant answer uses the same host-owned serializer. This
    // keeps paragraph boundaries, resource intent and finalization history
    // consistent; local projection below is recovery only.
    if (intent.kind !== "host_notice" && rewriter) {
      try {
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
        const parts = packAgentChannelFinalTextParts(delivery.parts, this.options.finalTextPacking);
        const projection = await projectAgentChannelFinalParts(parts, {
          resourceResolver: this.options.resourceResolver,
          resourceManifest,
        });
        if (this.disposed) return false;
        if (projection.segments.length > 0 || projection.caption.trim().length > 0) {
          const accepted = await this.deliverFinalProjection(projection);
          if (accepted) {
            const history = projectFinalizationHistory(projection, content, parts);
            await this.persistFinalization(history.content, history.parts, resourceManifest);
          }
          return accepted;
        }
        // An empty projection (e.g. whitespace-only parts) must not swallow
        // the answer; fall through to the plain-text delivery path below.
      } catch (error) {
        this.options.onFinalRewriteFailed?.(error);
      }
    }
    // If the model serializer is unavailable or rejected, keep the same
    // resource/marker safety boundary locally instead of sending raw Markdown
    // placeholders to the channel. This path is also useful for legacy callers
    // that do not configure a rewriter.
    if (intent.kind !== "host_notice" && needsResourceManifest) {
      try {
        const projection = await projectAgentChannelFinalParts([{ kind: "text", text: content }], {
          resourceResolver: this.options.resourceResolver,
          resourceManifest,
        });
        if (projection.segments.length > 0 || projection.caption.trim().length > 0) {
          return this.deliverFinalProjection(projection);
        }
      } catch (error) {
        this.options.onFinalRewriteFailed?.(error);
      }
      // A content made entirely of internal placeholders has no safe visible
      // fallback. Do not re-emit the original model projection after it has
      // been deliberately removed by the channel boundary.
      return true;
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
      return structure.codeBlockCount > 0 ? this.enqueueText(content) : this.enqueueTextByParagraphs(content);
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
    const activity = createAgentChannelActivity({
      activityId: this.options.requestId ?? createOpaqueId("channel_activity"),
      source: this.options.source,
      parts: segments.map((segment): AgentChannelActivityPart =>
        segment.kind === "text" ? { kind: "text", content: segment.content } : { kind: "media", media: segment.media },
      ),
      publication: {
        mode: "current_turn",
        resourceUris: segments.flatMap((segment) =>
          segment.kind === "media" && segment.media.resourceUri ? [segment.media.resourceUri] : [],
        ),
      },
    });
    return this.deliverActivity(activity);
  }

  private async deliverActivityPartsWithReceipt(
    parts: readonly AgentChannelActivityPart[],
  ): Promise<{ accepted: boolean; parts: AgentChannelActivityDeliveryReceipt["parts"] }> {
    if (this.disposed) return { accepted: false, parts: [] };
    const previewMessageId = this.previewMessageId;
    const segments = parts.map((part): AgentChannelOutboundSegment =>
      part.kind === "text" ? { kind: "text", content: part.content } : { kind: "media", media: part.media },
    );
    const hadPreview = Boolean(previewMessageId && this.options.adapter.capabilities.supportsEdit);
    let consumedTextIndex = -1;
    let consumedTextLength = 0;
    let consumedPreviewMessageId: string | undefined;
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
          consumedPreviewMessageId = previewMessageId;
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
    const receipts: Array<AgentChannelActivityDeliveryReceipt["parts"][number]> = [];
    for (let index = 0; index < segments.length; index += 1) {
      if (this.disposed) return { accepted: false, parts: receipts };
      const segment = segments[index];
      if (segment.kind === "text") {
        const skip = index === consumedTextIndex ? consumedTextLength : 0;
        const result = await this.enqueueTextWithReceipt(segment.content, skip);
        receipts.push({
          index,
          status: result.accepted ? "sent" : "failed",
          messageIds: [
            ...(index === consumedTextIndex && consumedPreviewMessageId ? [consumedPreviewMessageId] : []),
            ...result.messageIds,
          ],
          ...(result.code ? { errorCode: result.code } : {}),
        });
        accepted = result.accepted && accepted;
        continue;
      }
      const key = agentChannelMediaIdentity(segment.media);
      if (this.deliveredMedia.has(key)) {
        receipts.push({ index, status: "sent", messageIds: [] });
        continue;
      }
      if (this.options.adapter.capabilities.supportsMedia !== true) {
        this.reportDeliveryFailure(new Error("Channel adapter does not support media delivery."));
        receipts.push({ index, status: "failed", messageIds: [], errorCode: "unsupported" });
        accepted = false;
        continue;
      }
      const receipt = await this.options.delivery.enqueueAndWait(this.options.source, "", {
        chatType: this.options.source.chatType,
        media: [segment.media],
      });
      if (receipt.status === "sent") {
        this.deliveredMedia.add(key);
        receipts.push({ index, status: "sent", messageIds: [receipt.messageId] });
      } else {
        this.reportDeliveryFailure(receipt.error);
        receipts.push({ index, status: "failed", messageIds: [], errorCode: receipt.code });
        accepted = false;
      }
    }
    return { accepted, parts: receipts };
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
    return (await this.enqueueTextWithReceipt(content, skipPrefixLength)).accepted;
  }

  private async enqueueTextWithReceipt(
    content: string,
    skipPrefixLength = 0,
  ): Promise<{ accepted: boolean; messageIds: string[]; code?: string }> {
    if (this.disposed) return { accepted: false, messageIds: [] };
    if (!content.trim()) return { accepted: true, messageIds: [] };
    const max = this.options.adapter.capabilities.maxMessageLength;
    const payload = skipPrefixLength > 0 ? content.slice(skipPrefixLength) : content;
    const pending = this.options.adapter.capabilities.splitsLongMessages
      ? splitAgentChannelContent(payload, max)
      : [payload];
    let accepted = true;
    const messageIds: string[] = [];
    let code: string | undefined;
    for (const chunk of pending) {
      if (this.disposed) return { accepted: false, messageIds, ...(code ? { code } : {}) };
      if (!chunk.trim()) continue;
      const receipt = await this.options.delivery.enqueueAndWait(this.options.source, chunk);
      if (receipt.status === "sent") {
        this.deliveredAssistantContents.add(chunk.trim());
        messageIds.push(receipt.messageId);
      } else {
        this.reportDeliveryFailure(receipt.error);
        code = receipt.code;
        accepted = false;
      }
    }
    return { accepted, messageIds, ...(code ? { code } : {}) };
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

  private reportDeliveryFailure(error: unknown): void {
    this.options.onDeliveryFailed?.(error);
    if (this.deliveryFailureReported || this.disposed) return;
    this.deliveryFailureReported = true;
    // A failure receipt is itself a normal channel activity. It is deliberately
    // best-effort and guarded so a broken adapter cannot recurse forever.
    this.options.delivery.enqueue(this.options.source, agentErrorMessage("channels.delivery.droppedPrefix"));
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

function projectFinalizationHistory(
  projection: AgentChannelOutboundMediaProjection,
  originalContent: string,
  fallbackParts: readonly AgentChannelFinalPart[],
): { content: string; parts: readonly AgentChannelFinalPart[] } {
  if (projection.media.length === 0) return { content: originalContent, parts: fallbackParts };

  const parts: AgentChannelFinalPart[] = [];
  for (const segment of projection.segments) {
    if (segment.kind === "text") {
      if (segment.content.trim()) parts.push({ kind: "text", text: segment.content });
      continue;
    }
    const uri = stableMediaReference(segment.media);
    if (!uri) continue;
    parts.push({
      kind: "resource",
      uri,
      ...(segment.media.altText?.trim() ? { alt: segment.media.altText.trim() } : {}),
      mediaKind: segment.media.kind,
      ...(segment.media.contentType ? { mime: segment.media.contentType } : {}),
      ...(segment.media.filename ? { fileName: segment.media.filename } : {}),
    });
  }
  if (parts.length === 0) return { content: originalContent, parts: fallbackParts };

  const content = parts
    .map((part) => {
      if (part.kind === "text") return part.text;
      if (part.kind === "resource") return `![${part.alt ?? "resource"}](${part.uri})`;
      return part.code;
    })
    .join("\n\n");
  return { content, parts };
}

function stableMediaReference(media: AgentChannelMedia): string | undefined {
  return media.resourceUri ?? media.url ?? media.path;
}
