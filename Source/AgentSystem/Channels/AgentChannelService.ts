import { AgentEventKinds, withEventContext, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentChildRunRecord } from "../Orchestration/AgentChildRunTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentDelegationCompletionPort } from "../Orchestration/AgentDelegationRuntimeContracts.js";
import { AgentSessionMessageDispositions } from "../Session/AgentSessionMessageDisposition.js";
import { AgentSessionMessageQueueModes } from "../Session/AgentSessionMessageQueueMode.js";
import type { AgentSessionMessageQueueMode } from "../Session/AgentSessionMessageQueueMode.js";
import type { AgentSessionMessageAcceptance } from "../Session/AgentSessionMessageCoordinator.js";
import {
  AgentChannelBusyMessageModes,
  AgentChannelCommands,
  AgentChannelKinds,
  type AgentChannelAdapter,
  type AgentChannelAttachment,
  type AgentChannelBusyMessageMode,
  type AgentChannelCommand,
  type AgentChannelConfig,
  type AgentChannelClientConversation,
  type AgentChannelTask,
  type AgentChannelTimelineSync,
  type AgentChannelConnectionInfo,
  type AgentChannelConnectionState,
  type AgentChannelInboundMessage,
  type AgentChannelInteraction,
  type AgentChannelKind,
  type AgentChannelSource,
  type AgentChannelsConfig,
  type AgentChannelWebhookResponse,
} from "./AgentChannelTypes.js";
import type { AgentChannelSessionMappingStore } from "./AgentChannelSessionMappingStore.js";
import type { AgentChannelSessionLifecycle } from "./AgentChannelSessionLifecycle.js";
import { AgentChannelDelivery } from "./AgentChannelDelivery.js";
import { deliverAgentChannelMessageBatch } from "./AgentChannelMessageBatch.js";
import type { AgentChannelOutbox } from "./AgentChannelOutbox.js";
import type { AgentChannelIngress, AgentChannelIngressEntry } from "./AgentChannelIngress.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentChannelConversationGuard } from "./AgentChannelConversationGuard.js";
import { normalizeAgentResourceUri } from "../Resources/AgentResourceUri.js";
import { AgentChannelRunRenderer } from "./AgentChannelRunRenderer.js";
import type { AgentChannelAdapterRegistry } from "./AgentChannelAdapterRegistry.js";
import {
  resolveAgentChannelSessionId,
  serializeAgentChannelLane,
  serializeAgentChannelConversation,
  isSameAgentChannelConversation,
} from "./AgentChannelSessionIdentity.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import { renderAgentChannelCommandHelp } from "./AgentChannelCommandRegistry.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  AgentInteractionSurfaces,
  type AgentInteractionContext,
  type AgentInteractionInbox,
} from "../Interaction/AgentInteractionContext.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import {
  createAgentConversationSpace,
  type AgentProfileRouteRegistry,
} from "../Conversation/AgentConversationSpace.js";
import type { AgentChannelActivity } from "./AgentChannelActivity.js";
import type { AgentChannelToolPort, AgentChannelToolContext } from "./AgentChannelToolPort.js";
import { selectAgentChannelInbox, type AgentChannelInboxBudget } from "./AgentChannelInbox.js";
import {
  agentChannelHistoryEntryKey,
  matchesAgentChannelWait,
  type AgentChannelObservedEvent,
  type AgentChannelInboxReview,
  type AgentChannelSendReceipt,
  type AgentChannelMessageBatchReceipt,
  type AgentChannelWaitConditions,
} from "./AgentChannelParticipation.js";
import type { AgentChannelParticipationStore } from "./AgentChannelParticipationStore.js";
import type { IncomingMessage } from "node:http";
import type { AgentInteractionIdentityStore } from "../Interaction/AgentInteractionIdentityStore.js";
import { agentLegacyInteractionSubject } from "../Interaction/AgentInteractionIdentity.js";
import type { AgentChannelConversationStore } from "./AgentChannelConversationStore.js";
import type { WebSocket } from "ws";
import {
  commandArguments,
  authorizeChannelSource,
  projectChannelMessageSegments,
  describe,
  isChannelTerminalEvent,
  parseChannelCommand,
  renderInboundInput,
  summarizeCompletion,
} from "./AgentChannelServiceHelpers.js";

export { isChannelTerminalEvent, parseChannelCommand, summarizeCompletion } from "./AgentChannelServiceHelpers.js";

export const AgentChannelServiceDefaults = Object.freeze({
  enabled: false,
  approvalMode: "agent",
});

/** Maps the channel-level routing policy onto the session queue mode it selects. */
const AgentSessionQueueModeByBusyMessageMode: Readonly<
  Record<AgentChannelBusyMessageMode, AgentSessionMessageQueueMode>
> = {
  [AgentChannelBusyMessageModes.Steer]: AgentSessionMessageQueueModes.Steer,
  [AgentChannelBusyMessageModes.FollowUp]: AgentSessionMessageQueueModes.FollowUp,
};

export interface AgentChannelSessionPort {
  listQueuedInputs?(
    sessionId: string,
  ): readonly import("../Session/AgentSessionQueuedInput.js").AgentSessionQueuedInput[];
  resumeQueuedMessages?(): Promise<void>;
  registerInputSource?(source: import("../Session/AgentSessionQueuedInput.js").AgentSessionInputSource): () => void;
  acceptMessage(request: {
    agentId?: string;
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    input: string;
    approvalMode: AgentExecutionApprovalMode;
    attachments?: AgentUploadAttachment[];
    disposition: (typeof AgentSessionMessageDispositions)[keyof typeof AgentSessionMessageDispositions];
    queueMode?: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSyncer;
    metadata?: Record<string, unknown>;
    interaction?: AgentInteractionContext;
    admissionGuard?: () => boolean;
  }): Promise<AgentSessionMessageAcceptance>;
  closeSession?(request: { sessionId: string; onEvent?: AgentEventSyncer }): Promise<void>;
  truncateFromRequest?(request: { sessionId: string; requestId: string; onEvent?: AgentEventSyncer }): Promise<void>;
  cancelActiveRun(request: { sessionId: string; requestId?: string; onEvent?: AgentEventSyncer }): Promise<boolean>;
  requestActiveRunCancellation(request: {
    sessionId: string;
    requestId?: string;
    onEvent?: AgentEventSyncer;
  }): Promise<boolean>;
  steerActiveRun(request: {
    sessionId: string;
    requestId?: string;
    queueMode?: AgentSessionMessageQueueMode;
    input: string;
    interaction?: AgentInteractionContext;
  }): Promise<boolean>;
  hasActiveRun(sessionId: string): boolean;
  hasRequest?(sessionId: string, requestId: string): boolean;
  waitForIdle?(sessionId: string): Promise<void>;
}

export interface AgentEventSyncer {
  (event: AgentDomainEvent): void | Promise<void>;
}

export interface AgentChannelServiceOptions {
  readonly identities?: AgentInteractionIdentityStore;
  readonly conversations?: AgentChannelConversationStore;
  readonly config: () => AgentChannelsConfig;
  readonly registry: AgentChannelAdapterRegistry;
  readonly sessionManager: AgentChannelSessionPort;
  readonly mappingStore?: AgentChannelSessionMappingStore;
  readonly participationStore?: AgentChannelParticipationStore;
  readonly outbox?: AgentChannelOutbox;
  readonly ingress?: AgentChannelIngress;
  /** Uses the same configured capacity/estimator as model-facing observations. */
  readonly inboxBudget?: (source: AgentChannelSource, modelProviderId?: string) => AgentChannelInboxBudget;
  readonly sessionLifecycle?: AgentChannelSessionLifecycle;
  /** Stores inbound channel media so vision/audio-capable runs can resolve it. */
  readonly attachmentResolver?: (
    attachment: AgentChannelAttachment,
    source: AgentChannelSource,
    requestHeaders?: Readonly<Record<string, string>>,
  ) => Promise<AgentUploadAttachment | undefined>;
  /** Resolves durable Senera resources for native outbound channel media. */
  readonly resourceResolver?: AgentResourceResolverLike;
  /** Receives non-command button interactions after the adapter ACKs them. */
  readonly onInteraction?: (interaction: AgentChannelInteraction) => void | Promise<void>;
  readonly approvalMode?: () => AgentExecutionApprovalMode;
  readonly onLog?: (level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>) => void;
  readonly onStatusChanged?: (statuses: AgentChannelStatus[]) => void;
  /** Publishes adapter-originated run events to the shared event stream. */
  readonly onEvent?: AgentEventSyncer;
  readonly now?: () => Date;
}

export interface AgentChannelStatus {
  readonly kind: AgentChannelKind;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly state: AgentChannelConnectionState;
  readonly mode?: string;
  readonly error?: string;
  /** Adapter-owned, credential-free connection information for settings surfaces. */
  readonly connection?: AgentChannelConnectionInfo;
}

export type AgentChannelProactiveDeliveryRequest = {
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly createdAt: string;
} & (
  | {
      readonly content: string;
      readonly activity?: never;
    }
  | {
      /** Structured activity used by host jobs that already know publication intent. */
      readonly activity: AgentChannelActivity;
      readonly content?: never;
    }
);

interface ActiveChannel {
  readonly kind: AgentChannelKind;
  readonly config: AgentChannelConfig;
  readonly adapter: AgentChannelAdapter;
  readonly delivery: AgentChannelDelivery;
  readonly abort: AbortController;
  error?: string;
}

interface AgentChannelCommandContext {
  readonly message?: AgentChannelInboundMessage;
  readonly channel: ActiveChannel;
  readonly source: AgentChannelSource;
  readonly rawText?: string;
}

type AgentChannelCommandHandler = (context: AgentChannelCommandContext) => Promise<void>;

/**
 * Owns the channel subsystem lifecycle: resolves configuration into adapters,
 * wires inbound messages into senera sessions through the same boundaries the
 * web terminal uses, renders run events back into each channel lane, and
 * delivers detached-work completions. A channel fails independently: one
 * broken platform never takes the others or the runtime down.
 */
export class AgentChannelService implements AgentChannelToolPort {
  private readonly options: AgentChannelServiceOptions;
  private readonly active = new Map<AgentChannelKind, ActiveChannel>();
  private readonly renderers = new Map<string, AgentChannelRunRenderer>();
  /** Reads in a parallel tool batch become visible only to the following model decision. */
  private readonly inboxBatches = new Map<string, { requestId?: string; batchId: string; cursor: number }>();
  /** Keeps command/session behavior correct for lightweight hosts without a database store. */
  private readonly ephemeralLanes = new Map<string, { sessionId: string; epoch: number }>();
  private readonly conversationGuard = new AgentChannelConversationGuard();
  private readonly participantPumps = new Map<string, Promise<void>>();
  private readonly pendingParticipantPumps = new Set<string>();
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private readonly commandHandlers: ReadonlyMap<AgentChannelCommand, AgentChannelCommandHandler>;
  private startController?: AbortController;
  private started = false;
  private readonly now: () => Date;
  private eventSink?: AgentEventSyncer;
  private readonly queuedInbox = new Map<string, number>();
  private readonly ingressPumps = new Map<AgentChannelKind, Promise<void>>();
  private releaseInputSource?: () => void;
  /** Serializes start, stop, reconnect and config reconciliation operations. */
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(options: AgentChannelServiceOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.eventSink = options.onEvent;
    this.commandHandlers = new Map([
      [AgentChannelCommands.New, (context) => this.handleNewCommand(context)],
      [AgentChannelCommands.Stop, (context) => this.handleStopCommand(context)],
      [AgentChannelCommands.Status, (context) => this.handleStatusCommand(context)],
      [AgentChannelCommands.Queue, (context) => this.handleQueueCommand(context)],
      [AgentChannelCommands.Steer, (context) => this.handleSteerCommand(context)],
      [AgentChannelCommands.Help, (context) => this.handleHelpCommand(context)],
    ]);
  }

  /** Allows the server to attach the WebSocket broadcaster after construction. */
  setEventSink(sink: AgentEventSyncer | undefined): void {
    this.eventSink = sink;
  }

  async send(input: Parameters<AgentChannelToolPort["send"]>[0]): Promise<AgentChannelMessageBatchReceipt> {
    const { channel, source, cursor } = this.resolveChannelToolContext(input);
    const capabilities = channel.adapter.capabilitiesFor?.(source) ?? channel.adapter.capabilities;
    const replyToMessageId = input.reply ? (input.messageId ?? input.interaction?.message?.id) : undefined;
    if (input.reply && !replyToMessageId) throw new Error("There is no current Channel message to reply to.");
    if (input.mentionIds?.length) {
      if (capabilities.supportsMentions === false) {
        throw new Error("The current channel does not support native mentions.");
      }
      const conversation = channel.adapter.conversationContext?.(source);
      if (
        source.chatType !== "group" ||
        !conversation ||
        input.mentionIds.some(
          (id) => id === conversation.selfId || !conversation.participants.some((participant) => participant.id === id),
        )
      ) {
        throw new Error("Mentions must identify other participants in the current group.");
      }
    }
    return deliverAgentChannelMessageBatch({
      messages: input.messages,
      signal: input.signal,
      review: () => {
        this.resolveChannelToolContext(input);
        return input.allowUnread ? undefined : this.reviewInbox(input, channel, source, cursor);
      },
      deliver: (content, index) =>
        channel.delivery.enqueueAndWait(source, content, {
          ...this.toolDeliveryIdentity(input, index),
          task: this.toolTask(input),
          chatType: source.chatType,
          parts: [{ kind: "text", content }],
          ...(index === 0 && input.mentionIds?.length ? { mentionIds: input.mentionIds } : {}),
          ...(replyToMessageId && (index === 0 || capabilities.supportsQuotedReplies === false)
            ? { replyToMessageId }
            : {}),
        }),
      record: (content, messageId, index) =>
        this.recordSentMessage(input, channel, source, messageId, content, [
          ...(index === 0 && replyToMessageId ? [{ type: "reply", data: { id: replyToMessageId } }] : []),
          { type: "text", data: { text: content } },
        ]),
      onError: (error) =>
        this.log("error", "channels.message_batch_failed", {
          sessionId: input.sessionId,
          message: describe(error),
        }),
    });
  }

  async sendMedia(input: Parameters<AgentChannelToolPort["sendMedia"]>[0]): Promise<AgentChannelSendReceipt> {
    const { channel, source, cursor } = this.resolveChannelToolContext(input);
    const capabilities = channel.adapter.capabilitiesFor?.(source) ?? channel.adapter.capabilities;
    if (
      capabilities.supportsMedia === false ||
      (capabilities.mediaKinds && !capabilities.mediaKinds.includes(input.kind))
    )
      throw new Error(`The current channel does not support ${input.kind} media.`);
    const resolver = this.options.resourceResolver;
    if (!resolver) throw new Error("The channel resource resolver is unavailable.");
    const uri = normalizeAgentResourceUri(input.resource);
    const resource = uri ? await resolver.resolve(uri) : await resolver.resolveWorkspacePath?.(input.resource);
    if (!resource) throw new Error("The requested resource is missing or is not readable within this workspace.");
    if (input.kind !== "file" && !resource.mime.startsWith(`${input.kind}/`)) {
      throw new Error(
        `Cannot send ${resource.mime} as ${input.kind}. Choose the matching media kind or send it as a file.`,
      );
    }
    // Resource I/O may outlast a new message; check after resolving it.
    const review = !input.allowUnread && this.reviewInbox(input, channel, source, cursor);
    if (review) return review;
    const receipt = await channel.delivery.enqueueAndWait(source, "", {
      ...this.toolDeliveryIdentity(input),
      task: this.toolTask(input),
      chatType: source.chatType,
      parts: [
        {
          kind: "media",
          media: {
            kind: input.kind,
            path: resource.filePath,
            filename: input.fileName ?? resource.name,
            contentType: resource.mime,
            size: resource.size,
            contentHash: resource.sha256,
            ...(uri ? { resourceUri: uri } : {}),
          },
        },
      ],
      ...(input.messageId ? { replyToMessageId: input.messageId } : {}),
    });
    if (receipt.status !== "sent") throw new Error(`Channel media delivery failed: ${receipt.code}.`);
    this.recordSentMessage(input, channel, source, receipt.messageId, "", [
      {
        type: input.kind,
        data: { resource: input.resource, fileName: input.fileName ?? resource.name, mimeType: resource.mime },
      },
    ]);
    return { status: "sent", messageId: receipt.messageId };
  }

  private toolDeliveryIdentity(input: AgentChannelToolContext, messageIndex?: number): { deliveryId?: string } {
    return input.toolCallId
      ? {
          deliveryId: sha256HexOfCanonicalJson({
            sessionId: input.sessionId,
            requestId: input.requestId,
            toolCallId: input.toolCallId,
            ...(messageIndex === undefined ? {} : { messageIndex }),
          }),
        }
      : {};
  }

  private recordSentMessage(
    input: AgentChannelToolContext,
    channel: ActiveChannel,
    source: AgentChannelSource,
    messageId: string,
    text: string,
    segments: NonNullable<AgentChannelInboundMessage["segments"]>,
  ): void {
    // Adapters with a native timeline already publish their own exact outbound event.
    if (channel.adapter.recordsOutboundHistory?.(source)) return;
    const store = this.requireParticipationStore();
    const task = this.toolTask(input);
    const selfId = channel.adapter.conversationContext?.(source)?.selfId;
    store.append({
      source: { ...source, messageId },
      ...(selfId ? { senderId: selfId } : {}),
      task,
      text,
      segments,
      sentAt: this.now().toISOString(),
    });
    store.bind(source, `message:${messageId}`, task);
  }

  async poke(
    input: Parameters<AgentChannelToolPort["poke"]>[0],
  ): Promise<{ readonly status: "sent" } | AgentChannelInboxReview> {
    const { channel, source, cursor } = this.resolveChannelToolContext(input);
    if (
      !channel.adapter.poke ||
      (channel.adapter.capabilitiesFor?.(source) ?? channel.adapter.capabilities).supportsPoke === false
    )
      throw new Error("The current channel does not support poke events.");
    const review = !input.allowUnread && this.reviewInbox(input, channel, source, cursor);
    if (review) return review;
    await channel.adapter.poke(source, this.toolTask(input), input.targetId);
    return { status: "sent" };
  }

  async recall(input: Parameters<AgentChannelToolPort["recall"]>[0]): Promise<void> {
    const { channel, source } = this.resolveChannelToolContext(input);
    if (!channel.adapter.deleteMessage) throw new Error("The current channel does not support message recall.");
    const result = await channel.adapter.deleteMessage(source, input.messageId);
    if (result.kind !== "deleted") throw new Error("The current channel did not accept the message recall.");
    this.options.participationStore?.removeEvent(source, `message:${input.messageId}`);
  }

  async readHistory(input: Parameters<AgentChannelToolPort["readHistory"]>[0]) {
    const { channel } = this.resolveChannelToolContext(input);
    const task = this.toolTask(input);
    const store = this.requireParticipationStore();
    if (!input.limit) throw new Error("A validated history page size is required.");
    let page;
    while (true) {
      page = store.read(input.sessionId, input.limit, input.afterSequence);
      const stale = page.entries.filter(({ message }) => !this.isHistoryEntryCurrent(channel.adapter, message));
      if (!stale.length) break;
      for (const { message } of stale) store.removeEvent(message.source, agentChannelHistoryEntryKey(message)!);
    }
    // Only a contiguous read may advance the observed cursor. Explicitly
    // skipping ahead must not acknowledge events the model has never received.
    const participant = store.get(input.sessionId)!;
    if (input.afterSequence === undefined || input.afterSequence <= participant.cursor) {
      store.observe(input.sessionId, page.throughSequence);
    }
    for (const { message } of page.entries) {
      this.bindInboundHistory(channel.adapter, message.source, message, task, true);
    }
    return { ...page, entries: page.entries.map((entry) => this.identifyEntry(input.sessionId, channel, entry)) };
  }

  async updateConversation(input: Parameters<AgentChannelToolPort["updateConversation"]>[0]) {
    const { channel, source } = this.resolveChannelToolContext(input);
    if (!input.toolCallId || !input.requestId)
      throw new Error("Conversation decisions require a durable tool call identity.");
    const store = this.options.conversations;
    if (!store) throw new Error("Conversation coordination is unavailable on this host.");
    return store.update(
      input.sessionId,
      `${input.requestId}:${input.toolCallId}`,
      input,
      channel.adapter.conversationContext?.(source)?.selfId,
    );
  }

  async waitForMessage(input: Parameters<AgentChannelToolPort["waitForMessage"]>[0]) {
    const { channel, source, cursor } = this.resolveChannelToolContext(input);
    if (input.signal?.aborted) throw input.signal.reason;
    const task = this.toolTask(input);
    if (input.conditions.taskId) {
      const conversationTask = this.options.conversations?.task(input.sessionId, input.conditions.taskId);
      if (!conversationTask || conversationTask.status !== "waiting")
        throw new Error("Mark the task waiting before registering its continuation.");
      input = {
        ...input,
        conditions: {
          ...input.conditions,
          senderIds: input.conditions.senderIds ?? conversationTask.participantIds,
          wakeAt: input.conditions.wakeAt ?? conversationTask.wakeAt,
        },
      };
    }
    if (input.conditions.events.length === 0 && !input.conditions.wakeAt) {
      throw new Error("A channel wait requires an event condition or a wake time.");
    }
    if (input.conditions.wakeAt && !Number.isFinite(Date.parse(input.conditions.wakeAt))) {
      throw new Error("wakeAt must be an ISO 8601 timestamp with an explicit UTC offset.");
    }
    if (input.conditions.wakeAt && Date.parse(input.conditions.wakeAt) <= this.now().getTime()) {
      throw new Error("wakeAt must be in the future. Use the current host time when scheduling a return.");
    }
    const store = this.requireParticipationStore();
    const existing = store.get(input.sessionId);
    if (existing?.status === "waiting") throw new Error("This turn has already registered its channel wait.");
    const events = channel.adapter.capabilities.inboundEvents;
    if (events && input.conditions.events.some((event) => !events.includes(event))) {
      throw new Error(`This channel supports these wait events: ${events.join(", ")}.`);
    }
    if (input.conditions.senderIds?.length) {
      const conversation = channel.adapter.conversationContext?.(source);
      if (
        input.conditions.senderIds.some((id) =>
          conversation
            ? id === conversation.selfId || !conversation.participants.some((participant) => participant.id === id)
            : !store.hasObservedSender(input.sessionId, id),
        )
      )
        throw new Error("Wait senderIds must identify other verified participants in the current conversation.");
    }
    const review = this.reviewInbox(input, channel, source, cursor, input.conditions);
    if (review) return review;
    const registration = store.register(input.sessionId, task.requestId, input.conditions, input.interaction?.actor);
    this.scheduleParticipationWake();
    return registration;
  }

  async readArchive(input: Parameters<AgentChannelToolPort["readArchive"]>[0]) {
    const { channel, source } = this.resolveChannelToolContext(input);
    if (!input.limit) throw new Error("A validated archive page size is required.");
    if (!channel.adapter.readClientTimeline)
      throw new Error("The current channel has no durable conversation archive.");
    const page = await channel.adapter.readClientTimeline(source, input.before, input.limit);
    return { ...page, entries: page.entries.map(({ task: _task, ...entry }) => entry) };
  }

  get statuses(): AgentChannelStatus[] {
    const channelsConfig = this.options.config();
    const candidates = this.active.size > 0 ? [...this.active.keys()] : undefined;
    const kinds = candidates ?? this.options.registry.kinds();
    return kinds.map((kind) => {
      const active = this.active.get(kind);
      const config = channelsConfig.channels[kind];
      const state = active ? active.adapter.getConnectionState() : "stopped";
      return {
        kind,
        enabled: channelsConfig.enabled && (active !== undefined || config?.enabled === true),
        connected: state === "connected",
        state,
        mode: active?.config.mode,
        error: active?.error,
        connection: active?.adapter.getConnectionInfo?.(),
      };
    });
  }

  /** The shared listener authenticates the socket before the protocol receives it. */
  connectOneBot11Client(socket: WebSocket, request: IncomingMessage): void {
    const active = this.active.get(AgentChannelKinds.OneBot11);
    if (!active || active.adapter.getConnectionState() !== "connected" || !active.adapter.connectClient) {
      socket.close(1013, "OneBot channel is not connected");
      return;
    }
    active.adapter.connectClient(socket, request);
  }

  resolveClientConversation(kind: AgentChannelKind, conversation: AgentChannelClientConversation) {
    const source = this.resolveClientSource(kind, conversation);
    const lanes = this.clientLanes(source);
    const lane = lanes.length === 1 ? lanes[0] : undefined;
    return {
      platform: kind,
      ...conversation,
      sessionId: lane?.sessionId ?? null,
      epoch: lanes.reduce((sum, item) => sum + item.epoch, 0),
      sessionIds: lanes.map((item) => item.sessionId),
      running: lanes.some((item) => this.options.sessionManager.hasActiveRun(item.sessionId)),
    };
  }

  async readClientTimeline(
    kind: AgentChannelKind,
    conversation: AgentChannelClientConversation,
    before?: number,
    sync?: AgentChannelTimelineSync,
  ) {
    const source = this.resolveClientSource(kind, conversation);
    const adapter = this.active.get(kind)!.adapter;
    if (!adapter.readClientTimeline) throw new Error("This channel does not expose a client timeline.");
    return adapter.readClientTimeline(source, before, undefined, sync);
  }

  async readClientConversations(kind: AgentChannelKind) {
    const adapter = this.active.get(kind)?.adapter;
    if (adapter?.getConnectionState() !== "connected" || !adapter.readClientConversations)
      throw new Error("This channel does not expose a connected client conversation catalog.");
    return adapter.readClientConversations();
  }

  async deleteClientTask(
    kind: AgentChannelKind,
    conversation: AgentChannelClientConversation,
    messageId: string,
  ): Promise<void> {
    await this.truncateClientMessage(this.resolveClientSource(kind, conversation), messageId);
  }

  private async truncateClientMessage(
    source: AgentChannelSource,
    messageId: string,
    allowUnboundRecall = false,
  ): Promise<void> {
    const adapter = this.active.get(source.platform)?.adapter;
    const single = adapter?.resolveMessageTask?.(source, messageId);
    const tasks = adapter?.resolveMessageTasks?.(source, messageId) ?? (single ? [single] : []);
    if (tasks.length === 0 && allowUnboundRecall) {
      this.options.participationStore?.removeEvent(source, `message:${messageId}`);
      return;
    }
    if (tasks.length === 0)
      throw new Error("This message has no recorded task identity; it cannot be safely used as a history boundary.");
    const truncate = this.options.sessionManager.truncateFromRequest;
    if (!truncate) throw new Error("Session history management is unavailable.");
    for (const task of tasks) {
      let committed = false;
      await truncate.call(this.options.sessionManager, {
        ...task,
        onEvent: async (event) => {
          if (event.kind === AgentEventKinds.RequestInvalid || event.kind === AgentEventKinds.SessionNotFound) {
            throw new Error("The recorded task is no longer an editable history boundary.");
          }
          if (event.kind === AgentEventKinds.SessionTruncated) committed = true;
          await this.eventSink?.(event);
        },
      });
      if (!committed) throw new Error("The task history was not changed.");
    }
  }

  private toolTask(input: { sessionId: string; requestId?: string }): AgentChannelTask {
    if (!input.requestId) throw new Error("Channel actions require an authoritative current request identity.");
    return { sessionId: input.sessionId, requestId: input.requestId };
  }

  async clearClientConversation(
    kind: AgentChannelKind,
    conversation: AgentChannelClientConversation,
    expectedEpoch: number,
  ): Promise<boolean> {
    const source = this.resolveClientSource(kind, conversation);
    const key = serializeAgentChannelConversation(source);
    if (this.conversationGuard.isClearing(key)) return false;
    const lanes = this.clientLanes(source);
    if (lanes.reduce((sum, lane) => sum + lane.epoch, 0) !== expectedEpoch) return false;
    const lifecycle = this.options.sessionLifecycle;
    const closeSession = this.options.sessionManager.closeSession;
    if (!lifecycle || !closeSession) throw new Error("Channel conversation management is unavailable.");
    return this.conversationGuard.clear(key, async () => {
      this.options.participationStore?.clear(source);
      for (const lane of lanes) {
        await closeSession.call(this.options.sessionManager, { sessionId: lane.sessionId, onEvent: this.eventSink });
        // A lane can retain protocol messages even if its first model turn was
        // rejected before a Senera session existed. Release is idempotent.
        await lifecycle.release(lane.sessionId);
      }
      await this.options.registry.clearHistory(source);
    });
  }

  private clientLanes(source: AgentChannelSource) {
    return this.options.mappingStore?.listAll().filter((lane) => isSameAgentChannelConversation(lane, source)) ?? [];
  }

  private resolveClientSource(kind: AgentChannelKind, conversation: AgentChannelClientConversation) {
    const adapter = this.active.get(kind)?.adapter;
    if (!adapter?.resolveClientSource || adapter.getConnectionState() !== "connected") {
      throw new Error("The channel client is not connected.");
    }
    return adapter.resolveClientSource(conversation);
  }

  start(): Promise<void> {
    return this.enqueueLifecycle(() => this.startNow());
  }

  stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopNow());
  }

  /**
   * Reconciles live adapters with the latest persisted channel configuration.
   * Configuration writes are published synchronously, so this method is kept
   * behind the same lifecycle queue as explicit reconnect requests. That
   * prevents a save and a button click from creating two gateway sessions.
   */
  syncFromConfig(): Promise<void> {
    return this.enqueueLifecycle(() => this.syncFromConfigNow());
  }

  private async startNow(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.registerInputSource();
    this.startController = new AbortController();
    const channelsConfig = this.options.config();
    if (!channelsConfig.enabled) {
      this.log("info", "channels.disabled");
      this.options.onStatusChanged?.(this.statuses);
      return;
    }
    const failures: string[] = [];
    // Each platform owns its connection handshake. A remote platform must not
    // hold the local gateway (or any other independent channel) behind its I/O.
    await Promise.all(
      this.options.registry.kinds().map((kind) => this.startChannel(kind, channelsConfig.channels[kind], failures)),
    );
    this.options.onStatusChanged?.(this.statuses);
    if (failures.length > 0) {
      this.log("error", "channels.partial_failure", { failures });
    }
  }

  private async stopNow(): Promise<void> {
    this.started = false;
    this.releaseInputSource?.();
    this.releaseInputSource = undefined;
    clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
    this.startController?.abort();
    const channels = [...this.active.values()];
    this.active.clear();
    await Promise.allSettled(
      channels.map(async (channel) => {
        channel.abort.abort();
        channel.delivery.stop();
        await channel.adapter.disconnect().catch(() => undefined);
      }),
    );
    for (const renderer of this.renderers.values()) renderer.dispose();
    this.renderers.clear();
    this.inboxBatches.clear();
    this.queuedInbox.clear();
    this.ephemeralLanes.clear();
    this.pendingParticipantPumps.clear();
    await this.options.ingress?.drain();
    await Promise.allSettled(this.ingressPumps.values());
    this.options.onStatusChanged?.([]);
  }

  async connectChannelsForWebhook(): Promise<void> {
    // Webhook-mode channels connect lazily from the HTTP entry; polling and
    // gateway channels are already connected by start().
  }

  /**
   * (Re)connects a single channel from the settings UI without restarting the
   * runtime. Disposes the previous adapter and its in-flight renderers, then
   * starts a fresh one from the current configuration. No-ops when the
   * subsystem or the channel is disabled so the button never half-connects.
   */
  connectChannel(kind: AgentChannelKind): Promise<void> {
    return this.enqueueLifecycle(() => this.connectChannelNow(kind));
  }

  private async connectChannelNow(kind: AgentChannelKind): Promise<void> {
    const channelsConfig = this.options.config();
    if (!channelsConfig.enabled) {
      this.log("warn", "channels.disabled", { kind });
      return;
    }
    const config = channelsConfig.channels[kind];
    if (!config?.enabled) {
      this.log("warn", "channels.channel_disabled", { kind });
      return;
    }
    this.registerInputSource();
    const existing = this.active.get(kind);
    if (existing) {
      existing.abort.abort();
      existing.delivery.stop();
      await existing.adapter.disconnect().catch(() => undefined);
      this.active.delete(kind);
      this.disposeRenderersForAdapter(existing.adapter);
    }
    const failures: string[] = [];
    await this.startChannel(kind, config, failures);
    if (failures.length > 0) this.log("error", "channels.partial_failure", { failures });
    this.options.onStatusChanged?.(this.statuses);
  }

  private async syncFromConfigNow(): Promise<void> {
    if (!this.started) return;

    const channelsConfig = this.options.config();
    if (!channelsConfig.enabled) {
      await Promise.all([...this.active.keys()].map((kind) => this.disposeActiveChannel(kind)));
      this.options.onStatusChanged?.(this.statuses);
      return;
    }

    const failures: string[] = [];
    for (const kind of this.options.registry.kinds()) {
      const config = channelsConfig.channels[kind];
      const active = this.active.get(kind);
      if (!config?.enabled) {
        if (active) await this.disposeActiveChannel(kind);
        continue;
      }

      // A resolved config is a value object. Compare its canonical form so a
      // snapshot refresh with identical values does not flap a healthy socket.
      if (active && stringifyAgentCanonicalJson(active.config) === stringifyAgentCanonicalJson(config)) continue;
      if (active) await this.disposeActiveChannel(kind);
      await this.startChannel(kind, config, failures);
    }

    this.options.onStatusChanged?.(this.statuses);
    if (failures.length > 0) this.log("error", "channels.partial_failure", { failures });
  }

  private async disposeActiveChannel(kind: AgentChannelKind): Promise<void> {
    const channel = this.active.get(kind);
    if (!channel) return;
    this.active.delete(kind);
    channel.abort.abort();
    channel.delivery.stop();
    this.disposeRenderersForAdapter(channel.adapter);
    await channel.adapter.disconnect().catch(() => undefined);
  }

  private enqueueLifecycle(task: () => Promise<void>): Promise<void> {
    const next = this.lifecycleQueue.then(task, task);
    this.lifecycleQueue = next.catch(() => undefined);
    return next;
  }

  private disposeRenderersForAdapter(adapter: AgentChannelAdapter): void {
    for (const [requestId, renderer] of this.renderers) {
      if (renderer.options.adapter === adapter) {
        renderer.dispose();
        this.renderers.delete(requestId);
      }
    }
  }

  /**
   * Gives adapters a chance to answer a platform handshake before normal
   * event authentication and delivery. QQ's op=13 callback verification is
   * the first consumer; other channels simply return undefined.
   */
  async deliverWebhookVerification(
    kind: AgentChannelKind,
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<AgentChannelWebhookResponse | undefined> {
    const channel = this.active.get(kind);
    if (!channel || typeof channel.adapter.handleWebhookVerification !== "function") return undefined;
    return channel.adapter.handleWebhookVerification(payload, rawBody, headers);
  }

  /** HTTP webhook entries push platform payloads here; returns false when the payload is not ours. */
  async deliverWebhookUpdate(
    kind: AgentChannelKind,
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<boolean> {
    const channel = this.active.get(kind);
    if (!channel) return false;
    if (typeof channel.adapter.handleWebhookUpdate !== "function") return false;
    // QQ's official callback signature is derived from AppSecret. A separate
    // webhookSecret is supported as an override, but should not be mandatory
    // (unlike Telegram's dedicated webhook token).
    if (!channel.config.webhookSecret && kind !== AgentChannelKinds.Qq) {
      this.log("error", "channels.webhook_missing_secret", { kind });
      throw new Error(`Channel ${kind} webhook requires webhookSecret.`);
    }
    return channel.adapter.handleWebhookUpdate(payload, rawBody, headers);
  }

  private async startChannel(
    kind: AgentChannelKind,
    config: AgentChannelConfig | undefined,
    failures: string[],
  ): Promise<ActiveChannel | undefined> {
    if (!config?.enabled) return undefined;
    let adapter: AgentChannelAdapter;
    try {
      adapter = this.options.registry.create(kind, config);
    } catch (error) {
      failures.push(`${kind}: ${describe(error)}`);
      return undefined;
    }
    const abort = new AbortController();
    const delivery = new AgentChannelDelivery({
      adapter,
      outbox: this.options.outbox,
      authorize: (source) =>
        this.active.get(kind)?.adapter === adapter &&
        authorizeChannelSource(config, source) &&
        adapter.canParticipate?.(source) !== false,
      onError: (error, source) => this.log("warn", "channels.send_failed", { kind, source, message: describe(error) }),
      onDropped: (content, source, error, options) =>
        this.log("error", "channels.send_dropped", {
          kind,
          source,
          contentLength: content.length,
          mediaCount: options?.media?.length ?? 0,
          mediaKinds: options?.media?.map((media) => media.kind) ?? [],
          message: describe(error),
        }),
    });
    const channel: ActiveChannel = { kind, config, adapter, delivery, abort };
    this.active.set(kind, channel);
    adapter.bind({
      onRecall: (source, messageId) => this.truncateClientMessage(source, messageId, true),
      onMessage: (message) => this.handleInbound(channel, message),
      onConnectionStateChanged: (state) => {
        // A replaced adapter may finish an old reconnect after a new one is
        // active. Its state must never overwrite the current channel status.
        if (this.active.get(kind) !== channel) return;
        // Errors describe the previous failed attempt. A fresh attempt or a
        // successful handshake gets a clean status; a degraded state keeps
        // the latest diagnostic visible to the operator.
        if (state === "connecting" || state === "reconnecting" || state === "connected") {
          channel.error = undefined;
        }
        this.options.onStatusChanged?.(this.statuses);
        if (state === "connected") this.restoreParticipation(kind);
      },
      onFatal: (error) => {
        if (this.active.get(kind) !== channel) return;
        this.log("error", "channels.adapter_fatal", { kind, message: describe(error) });
        channel.error = describe(error);
        this.options.onStatusChanged?.(this.statuses);
      },
      onInteraction: (interaction) => this.handleInteraction(channel, interaction),
      onEvent: (source, event, task) =>
        this.handleInbound(channel, { source, text: "", event, ...(task ? { task } : {}), sentAt: event.sentAt }),
      onParticipantsChanged: async () => {
        if (this.active.get(kind) !== channel) return;
        for (const participant of this.options.participationStore?.list() ?? []) {
          if (participant.source.platform !== kind) continue;
          if (adapter.canParticipate?.(participant.source) === false) {
            this.options.participationStore?.pause(participant.sessionId);
            await this.options.sessionManager.requestActiveRunCancellation({ sessionId: participant.sessionId });
          } else {
            void this.pumpParticipant(participant.sessionId);
          }
        }
        this.scheduleParticipationWake();
      },
    });
    try {
      await adapter.connect(abort.signal);
      if (config.mode === "webhook" && kind === AgentChannelKinds.Telegram) {
        const setWebhook = adapter as AgentChannelAdapter & { registerWebhook?: () => Promise<boolean> };
        const registered = await setWebhook.registerWebhook?.();
        this.log(
          registered === false ? "warn" : "info",
          registered === false ? "channels.webhook_register_failed" : "channels.webhook_registered",
          { kind },
        );
      }
      const connectionState = adapter.getConnectionState();
      this.log("info", connectionState === "connected" ? "channels.connected" : "channels.connecting", {
        kind,
        mode: config.mode ?? "long_polling",
        state: connectionState,
      });
      this.restoreParticipation(kind);
    } catch (error) {
      channel.error = describe(error);
      this.log("error", "channels.connect_failed", { kind, message: describe(error) });
      // The adapter remains registered so a later reconnect attempt can reuse
      // its state; delivery for this channel fails closed with logged errors.
    }
    return channel;
  }

  private async handleInbound(
    channel: ActiveChannel,
    message: AgentChannelInboundMessage,
    recovered?: AgentChannelIngressEntry,
  ): Promise<void> {
    const { source, text } = message;
    const trimmed = text.trim();
    const input = renderChannelInboundInput(message);
    if (!input.trim() && !message.attachments?.length && !message.event) return;

    if (!authorizeChannelSource(channel.config, source)) {
      if (recovered) {
        await this.options.ingress?.run(recovered, async () => "discarded");
        return;
      }
      this.log("warn", "channels.message_denied", { kind: channel.kind, chatId: source.chatId });
      // A policy rejection is host feedback, not an Agent delivery. It must
      // not enter the outbox whose permission check correctly rejects this source.
      await channel.adapter.send(source, agentErrorMessage("channels.denied"));
      return;
    }

    const commandInput =
      message.segments?.length &&
      message.segments.every((segment) => segment.type === "text" || segment.type === "at" || segment.type === "reply")
        ? message.segments
            .filter((segment) => segment.type === "text")
            .map((segment) => String(segment.data.text ?? ""))
            .join("")
            .trim()
        : trimmed;
    const command = parseChannelCommand(commandInput, channel.adapter.capabilities.commandPrefix);
    if (command && !recovered) {
      if (channel.adapter.canExecuteCommand?.(message, command) === false) {
        channel.delivery.enqueue(source, agentErrorMessage("channels.denied"));
        return;
      }
      const recipients = channel.adapter.routeCommand?.(message) ?? [source];
      if (recipients.length) {
        await Promise.all(
          recipients.map((recipient) => this.handleCommand(channel, recipient, command, commandInput, message)),
        );
        return;
      }
    }

    const recipients = channel.adapter.routeInbound?.(message) ?? [source];
    const observers =
      recovered?.targets.map((target) => target.source) ?? channel.adapter.observeInbound?.(message) ?? recipients;
    if (
      observers.length === 0 &&
      !(this.options.participationStore && channel.adapter.capabilities.automaticDelivery === false)
    )
      return;
    const key = serializeAgentChannelConversation(source);
    if (this.conversationGuard.isClearing(key)) return;
    const conversationCurrent = this.conversationGuard.capture(key);
    const current = () =>
      conversationCurrent() &&
      this.active.get(channel.kind) === channel &&
      this.isHistoryEntryCurrent(channel.adapter, message);
    const lanes = await Promise.all(
      observers.map(async (recipient, index) => {
        await this.options.sessionLifecycle?.waitFor(recipient);
        if (recovered) {
          const target = recovered.targets[index]!;
          return current() &&
            this.isCurrentLane(recipient, target.sessionId) &&
            authorizeChannelSource(channel.config, recipient) &&
            channel.adapter.canParticipate?.(recipient) !== false
            ? { sessionId: target.sessionId, epoch: 0 }
            : undefined;
        }
        return current() ? this.resolveLane(recipient, false) : undefined;
      }),
    );
    const journal = this.options.ingress;
    const entry =
      recovered ??
      journal?.capture(
        message,
        observers.flatMap((recipient, index) =>
          lanes[index] ? [{ source: recipient, sessionId: lanes[index]!.sessionId }] : [],
        ),
      );
    if (journal && entry) {
      await journal.run(entry, async () => {
        // Redeliveries retain their original targets, even if /new changed
        // the current lane while attachment import or the process was stopped.
        const targets = entry.targets.map((target) => target.source);
        const capturedLanes = entry.targets.map((target) =>
          this.isCurrentLane(target.source, target.sessionId) &&
          authorizeChannelSource(channel.config, target.source) &&
          channel.adapter.canParticipate?.(target.source) !== false
            ? { sessionId: target.sessionId }
            : undefined,
        );
        return this.dispatchInbound(
          channel,
          entry.message,
          renderChannelInboundInput(entry.message),
          targets,
          capturedLanes,
          current,
        );
      });
    } else await this.dispatchInbound(channel, message, input, observers, lanes, current);
  }

  private async dispatchInbound(
    channel: ActiveChannel,
    message: AgentChannelInboundMessage,
    input: string,
    observers: readonly AgentChannelSource[],
    lanes: readonly ({ sessionId: string } | undefined)[],
    current: () => boolean,
  ): Promise<"pending" | "accepted" | "discarded"> {
    const source = message.source;
    const store = this.options.participationStore;
    const explicit = store && channel.adapter.capabilities.automaticDelivery === false;
    // Ambient group history remains readable even with no current observer.
    if (!lanes.some(Boolean) && !(explicit && observers.length === 0)) return "discarded";
    const attachments = await this.resolveInboundAttachments(source, message.attachments, message.segments);
    if (channel.abort.signal.aborted) return "pending";
    if (!current()) return "discarded";
    if (explicit) {
      const { raw: _raw, attachments: _nativeAttachments, task: _task, ...normalized } = message;
      if (message.event?.type === "recall" && message.event.messageId) {
        store.removeEvent(source, `message:${message.event.messageId}`);
      }
      const actor = this.resolveActor(channel, observers[0] ?? source, message);
      const observed = store.append(
        {
          ...normalized,
          source: observers[0] ?? source,
          segments: projectChannelMessageSegments(message, attachments),
        },
        attachments,
        actor ? { reference: actor.reference, kind: actor.kind } : undefined,
      );
      if (message.task) {
        store.bind(source, agentChannelHistoryEntryKey(message)!, message.task);
      }
      await Promise.all(
        observers.map(async (recipient, index) => {
          const lane = lanes[index];
          if (!lane || !current() || !this.isCurrentLane(recipient, lane.sessionId)) return;
          // A new member starts at this dispatch, while earlier history stays explicitly readable.
          store.ensure(lane.sessionId, recipient, observed.sequence - 1);
          void this.pumpParticipant(lane.sessionId);
        }),
      );
      return "accepted";
    }
    const accepted = await Promise.all(
      observers.map((recipient, index) => {
        const lane = lanes[index];
        if (!lane || !current() || !this.isCurrentLane(recipient, lane.sessionId)) return;
        return this.handleRecipient(channel, { ...message, source: recipient }, input, attachments, lane, current);
      }),
    );
    if (accepted.some((result) => result === false))
      throw new Error("The channel input was not accepted by its target session.");
    return "accepted";
  }

  private async handleRecipient(
    channel: ActiveChannel,
    message: AgentChannelInboundMessage,
    input: string,
    attachments: AgentUploadAttachment[] | undefined,
    lane: { sessionId: string },
    current: () => boolean,
  ): Promise<boolean> {
    const source = message.source;
    if (!this.isCurrentLane(source, lane.sessionId)) return false;

    // QQ's input-notify is a best-effort presence signal. Start it only for
    // inputs that continue through the normal channel turn pipeline.
    const typing = channel.adapter.sendTyping?.(source);
    void typing?.catch(() => undefined);
    return this.submitToSession(channel, source, lane.sessionId, input, attachments, message, current);
  }

  private async resolveInboundAttachments(
    source: AgentChannelSource,
    attachments: readonly AgentChannelAttachment[] | undefined,
    segments?: AgentChannelInboundMessage["segments"],
  ): Promise<AgentUploadAttachment[] | undefined> {
    if (!attachments?.length) return undefined;
    if (!this.options.attachmentResolver) throw new Error("The channel attachment store is unavailable.");
    const resolved: AgentUploadAttachment[] = [];
    for (const nativeAttachment of attachments) {
      let attachment = nativeAttachment;
      try {
        const adapter = this.active.get(source.platform)?.adapter;
        attachment = (await adapter?.resolveInboundAttachment?.(attachment, source, segments)) ?? attachment;
        const requestHeaders = await this.active
          .get(source.platform)
          ?.adapter.getInboundAttachmentHeaders?.(attachment, source);
        const uploaded = await this.options.attachmentResolver(attachment, source, requestHeaders);
        if (!uploaded) throw new Error(`Unable to resolve channel attachment ${attachment.filename ?? attachment.id}.`);
        resolved.push(uploaded);
      } catch (error) {
        this.log("warn", "channels.attachment_ingest_failed", {
          kind: source.platform,
          chatId: source.chatId,
          name: attachment.filename,
          message: describe(error),
        });
        throw error;
      }
    }
    return resolved.length > 0 ? resolved : undefined;
  }

  private async resolveLane(
    source: AgentChannelSource,
    forceNew: boolean,
  ): Promise<{ sessionId: string; epoch: number }> {
    const store = this.options.mappingStore;
    const laneKey = serializeAgentChannelLane(source);
    const existing = store?.getByLane(source) ?? this.ephemeralLanes.get(laneKey);
    if (forceNew || !existing) {
      let epoch = forceNew ? (existing?.epoch ?? 0) + 1 : 1;
      let sessionId = resolveAgentChannelSessionId(source, epoch);
      // Repair mappings written by older builds that bumped the session id but
      // persisted epoch=1. Never hand /new the same id twice in that state.
      while (forceNew && existing && sessionId === existing.sessionId) {
        epoch += 1;
        sessionId = resolveAgentChannelSessionId(source, epoch);
      }
      const now = this.now().toISOString();
      if (store) {
        if (forceNew) store.resetEpoch(source, sessionId, epoch, now);
        else store.upsert(source, sessionId, epoch, now);
      } else {
        this.ephemeralLanes.set(laneKey, { sessionId, epoch });
      }
      return { sessionId, epoch };
    }
    if (store) store.touch(source, this.now().toISOString());
    return { sessionId: existing.sessionId, epoch: existing.epoch };
  }

  private resolveChannelToolLane(
    sessionId: string,
    interaction: AgentInteractionContext | undefined,
  ): { channel: ActiveChannel; source: AgentChannelSource } {
    if (interaction?.surface !== AgentInteractionSurfaces.Channel || !interaction.platform) {
      throw new Error("Channel tools require an active conversation with explicit delivery.");
    }
    const lane = this.options.mappingStore?.getBySession(sessionId);
    if (!lane || lane.platform !== interaction.platform) {
      throw new Error("The current session is not bound to an active channel lane.");
    }
    const channel = this.active.get(lane.platform);
    if (
      !channel ||
      channel.adapter.capabilities.automaticDelivery !== false ||
      channel.abort.signal.aborted ||
      channel.adapter.getConnectionState(lane) !== "connected"
    ) {
      throw new Error("The channel gateway is unavailable.");
    }
    const mapped: AgentChannelSource = {
      ...(lane.authority ? { authority: lane.authority } : {}),
      ...(lane.agentId ? { agentId: lane.agentId } : {}),
      platform: lane.platform,
      chatType: lane.chatType,
      chatId: lane.chatId,
      userId: lane.userId,
      ...(lane.threadId ? { threadId: lane.threadId } : {}),
    };
    if (!this.isCurrentLane(mapped, sessionId) || channel.adapter.canParticipate?.(mapped) === false) {
      throw new Error("This Agent is no longer an enabled participant in the current conversation.");
    }
    return { channel, source: mapped };
  }

  private resolveChannelToolContext(input: AgentChannelToolContext) {
    const lane = this.resolveChannelToolLane(input.sessionId, input.interaction);
    lane.source = { ...lane.source, messageId: input.interaction?.message?.id };
    if (input.taskId) {
      const task = this.options.conversations?.task(input.sessionId, input.taskId);
      if (!task || task.status === "cancelled") throw new Error("This conversation task is unavailable.");
    }
    this.observeInbox(input, lane.channel);
    const cursor = this.requireParticipationStore().get(input.sessionId)!.cursor;
    if (!input.batchId) return { ...lane, cursor };
    let batch = this.inboxBatches.get(input.sessionId);
    if (batch?.requestId !== input.requestId || batch?.batchId !== input.batchId) {
      batch = { requestId: input.requestId, batchId: input.batchId, cursor };
      this.inboxBatches.set(input.sessionId, batch);
    }
    return { ...lane, cursor: batch.cursor };
  }

  private observeInbox(input: AgentChannelToolContext, channel: ActiveChannel): void {
    const inbox = input.interaction?.inbox;
    if (!inbox) return;
    const store = this.requireParticipationStore();
    const participant = store.get(input.sessionId);
    if (!participant || inbox.afterSequence > participant.cursor || inbox.throughSequence <= participant.cursor) return;
    this.observeInboxPage(input, channel, inbox);
  }

  private observeInboxPage(input: AgentChannelToolContext, channel: ActiveChannel, inbox: AgentInteractionInbox): void {
    this.requireParticipationStore().observe(input.sessionId, inbox.throughSequence);
    const task = this.toolTask(input);
    for (const { message } of inbox.entries) {
      this.bindInboundHistory(channel.adapter, message.source, message, task, true);
    }
  }

  private readInbox(sessionId: string, channel: ActiveChannel, afterSequence: number): AgentInteractionInbox {
    const store = this.requireParticipationStore();
    const source = store.get(sessionId)!.source;
    const budget = this.options.inboxBudget?.(source, this.createConversationSpace(sessionId, source).modelProviderId);
    if (!budget) throw new Error("Durable channel participation requires a model-facing inbox budget.");
    let page;
    while (true) {
      page = store.read(sessionId, budget.pageSize, afterSequence);
      const stale = page.entries.filter(({ message }) => !this.isHistoryEntryCurrent(channel.adapter, message));
      if (!stale.length) break;
      for (const { message } of stale) store.removeEvent(message.source, agentChannelHistoryEntryKey(message)!);
    }
    return selectAgentChannelInbox(
      { ...page, entries: page.entries.map((entry) => this.identifyEntry(sessionId, channel, entry)) },
      afterSequence,
      budget,
    );
  }

  private identifyEntry(
    sessionId: string,
    channel: ActiveChannel,
    entry: AgentChannelObservedEvent,
  ): AgentChannelObservedEvent {
    if (entry.actor || (entry.message.task && !entry.message.senderId)) return entry;
    const actor = this.resolveActor(channel, this.requireParticipationStore().get(sessionId)!.source, entry.message);
    return actor ? { ...entry, actor: { reference: actor.reference, kind: actor.kind } } : entry;
  }

  private conversationState(sessionId: string, source: AgentChannelSource) {
    const state = this.options.conversations?.state(sessionId);
    if (!state) return undefined;
    const budget = this.options.inboxBudget?.(source, this.createConversationSpace(sessionId, source).modelProviderId);
    if (!budget) throw new Error("Conversation coordination requires a model-facing budget.");
    const tasks: (typeof state.tasks)[number][] = [];
    for (const task of state.tasks) {
      const candidate = {
        tasks: [...tasks, task],
        totalTasks: state.tasks.length,
        hasMore: tasks.length + 1 < state.tasks.length,
      };
      if (tasks.length >= budget.pageSize || !budget.fits(JSON.stringify(candidate))) break;
      tasks.push(task);
    }
    return { tasks, totalTasks: state.tasks.length, hasMore: tasks.length < state.tasks.length };
  }

  private resolveActor(channel: ActiveChannel, source: AgentChannelSource, message?: AgentChannelInboundMessage) {
    if (!this.options.identities) return undefined;
    const senderId = message?.event?.actorId ?? message?.senderId ?? source.userId;
    const binding = channel.adapter.resolveActor?.(senderId, source);
    if (!binding) return undefined;
    const route =
      !source.agentId && (binding.owner || binding.kind === "agent")
        ? this.resolveProfileRoutes()?.resolve(this.conversationAddress(source))
        : undefined;
    if (route?.status === "ambiguous") throw new Error("Channel identity has an ambiguous profile route.");
    return this.options.identities.resolve({
      ...binding,
      ...(binding.owner || binding.kind === "agent"
        ? {
            legacySubjectId: agentLegacyInteractionSubject({
              surface: "channel",
              platform: source.platform,
              profileId: source.agentId ?? (route?.status === "matched" ? route.route.profileId : undefined),
              message: { senderId },
            }),
          }
        : {}),
    });
  }

  private registerInputSource(): void {
    if (this.releaseInputSource) return;
    this.releaseInputSource = this.options.sessionManager.registerInputSource?.({
      beforeInput: (boundary) => this.beforeModelInput(boundary),
      delivered: (input) => {
        if (!input.request.interaction?.inbox) return;
        const lane = this.options.mappingStore?.getBySession(input.sessionId);
        const channel = lane ? this.active.get(lane.platform) : undefined;
        if (!channel || channel.adapter.capabilities.automaticDelivery !== false) return;
        this.observeInbox(
          { sessionId: input.sessionId, requestId: input.parentRequestId, interaction: input.request.interaction },
          channel,
        );
        if ((this.queuedInbox.get(input.sessionId) ?? 0) <= input.request.interaction.inbox.throughSequence)
          this.queuedInbox.delete(input.sessionId);
      },
    });
  }

  private async beforeModelInput(
    boundary: import("../Session/AgentSessionQueuedInput.js").AgentSessionInputBoundary,
  ): Promise<void> {
    const lane = this.options.mappingStore?.getBySession(boundary.sessionId);
    const channel = lane ? this.active.get(lane.platform) : undefined;
    if (!channel || !lane || !boundary.interaction || channel.abort.signal.aborted) return;
    if (boundary.phase === "start") {
      void channel.adapter.sendTyping?.(lane).catch((error: unknown) => {
        this.log("warn", "channels.typing_failed", { kind: channel.kind, message: describe(error) });
      });
    }
    if (channel.adapter.capabilities.automaticDelivery !== false || !this.options.participationStore) return;
    const participant = this.options.participationStore.get(boundary.sessionId);
    if (
      !participant ||
      participant.status === "paused" ||
      !this.isCurrentLane(participant.source, boundary.sessionId) ||
      !authorizeChannelSource(channel.config, participant.source) ||
      channel.adapter.canParticipate?.(participant.source) === false
    )
      return;
    if (boundary.phase !== "start") this.observeInbox({ ...boundary }, channel);
    if (
      boundary.phase === "observe" ||
      (channel.config.busyMessageMode === AgentChannelBusyMessageModes.FollowUp && boundary.phase !== "follow_up")
    )
      return;
    const cursor = this.options.participationStore.get(boundary.sessionId)!.cursor;
    const queued = this.options.sessionManager.listQueuedInputs?.(boundary.sessionId) ?? [];
    const after = Math.max(
      cursor,
      boundary.interaction.inbox?.throughSequence ?? cursor,
      this.queuedInbox.get(boundary.sessionId) ?? cursor,
      ...queued.map((input) => input.request.interaction?.inbox?.throughSequence ?? cursor),
    );
    if (
      !this.hasRelevantInbox(
        boundary.sessionId,
        channel,
        participant.source,
        after,
        participant.status === "waiting" ? participant.conditions : undefined,
      )
    )
      return;
    const inbox = this.readInbox(boundary.sessionId, channel, after);
    if (!inbox.entries.length) return;
    const accepted = await this.options.sessionManager.steerActiveRun({
      sessionId: boundary.sessionId,
      queueMode: AgentSessionQueueModeByBusyMessageMode[channel.config.busyMessageMode],
      // The ordered inbox owns every speaker. Do not attribute its last text to the original task owner.
      input: "",
      interaction: {
        ...boundary.interaction,
        inbox,
        ...(this.options.conversations
          ? { coordination: this.conversationState(boundary.sessionId, participant.source) }
          : {}),
      },
    });
    if (accepted) this.queuedInbox.set(boundary.sessionId, inbox.throughSequence);
  }

  private reviewInbox(
    input: AgentChannelToolContext,
    channel: ActiveChannel,
    source: AgentChannelSource,
    afterSequence: number,
    conditions?: AgentChannelWaitConditions,
  ): AgentChannelInboxReview | undefined {
    if (!conditions && input.taskId) {
      const task = this.options.conversations!.task(input.sessionId, input.taskId);
      conditions = {
        taskId: task.id,
        events: ["message", "mention", "reply", "poke", "recall", "membership"],
        senderIds: task.participantIds,
      };
    }
    if (!this.hasRelevantInbox(input.sessionId, channel, source, afterSequence, conditions)) return undefined;
    const inbox = this.readInbox(input.sessionId, channel, afterSequence);
    this.observeInboxPage(input, channel, inbox);
    return { status: "needs_review", inbox };
  }

  private hasRelevantInbox(
    sessionId: string,
    channel: ActiveChannel,
    source: AgentChannelSource,
    afterSequence: number,
    conditions?: AgentChannelWaitConditions,
  ): boolean {
    const store = this.requireParticipationStore();
    const participant = store.get(sessionId)!;
    const selfId = channel.adapter.conversationContext?.(source)?.selfId;
    let changed = false;
    for (const { message, sequence } of store.eventsAfter(sessionId, afterSequence)) {
      if (!this.isHistoryEntryCurrent(channel.adapter, message)) continue;
      if (message.task?.sessionId === sessionId) continue;
      if (selfId && (message.event?.actorId ?? message.senderId ?? message.source.userId) === selfId) continue;
      if (conditions && !matchesAgentChannelWait({ ...participant, conditions }, message, selfId)) continue;
      if (this.options.conversations?.relevant(sessionId, sequence, conditions?.taskId) === false) continue;
      changed = true;
      break;
    }
    // Close the SQLite iterator before acknowledging/binding returned events.
    return changed;
  }

  private isCurrentLane(source: AgentChannelSource, sessionId: string): boolean {
    const lane =
      this.options.mappingStore?.getByLane(source) ?? this.ephemeralLanes.get(serializeAgentChannelLane(source));
    return lane?.sessionId === sessionId;
  }

  private isHistoryEntryCurrent(
    adapter: AgentChannelAdapter,
    message: Pick<AgentChannelInboundMessage, "source" | "event">,
  ): boolean {
    const key = agentChannelHistoryEntryKey(message);
    return !key || adapter.isHistoryEntryCurrent?.(message.source, key) !== false;
  }

  private requireParticipationStore(): AgentChannelParticipationStore {
    const store = this.options.participationStore;
    if (!store) throw new Error("Durable channel participation is unavailable on this host.");
    return store;
  }

  private pumpParticipant(sessionId: string): Promise<void> {
    const running = this.participantPumps.get(sessionId);
    if (running) {
      this.pendingParticipantPumps.add(sessionId);
      return running;
    }
    const pump = Promise.resolve()
      .then(() => this.runParticipant(sessionId))
      .catch((error: unknown) => {
        this.log("error", "channels.participation_failed", { sessionId, message: describe(error) });
      })
      .finally(() => {
        this.participantPumps.delete(sessionId);
        if (this.pendingParticipantPumps.delete(sessionId) && this.started) void this.pumpParticipant(sessionId);
        this.scheduleParticipationWake();
      });
    this.participantPumps.set(sessionId, pump);
    return pump;
  }

  private async runParticipant(sessionId: string): Promise<void> {
    const store = this.requireParticipationStore();
    while (this.started) {
      const participant = store.get(sessionId);
      if (!participant || participant.status === "paused") return;
      const channel = this.active.get(participant.source.platform);
      if (
        !channel ||
        channel.abort.signal.aborted ||
        channel.adapter.getConnectionState(participant.source) !== "connected" ||
        !this.isCurrentLane(participant.source, sessionId)
      )
        return;
      if (channel.adapter.canParticipate?.(participant.source) === false) {
        store.pause(sessionId);
        return;
      }
      // Reconcile the durable session receipt after a crash between turn
      // admission and acknowledging the participation journal.
      if (
        participant.status === "ready" &&
        participant.resumeRequestId &&
        this.options.sessionManager.hasRequest?.(sessionId, participant.resumeRequestId)
      ) {
        if (participant.conditions?.taskId && participant.scheduledRevision)
          this.options.conversations?.evaluated(
            sessionId,
            participant.conditions.taskId,
            participant.scheduledRevision,
            participant.resumeRequestId,
          );
        store.accept(sessionId, participant.resumeRequestId);
        continue;
      }
      if (this.options.sessionManager.hasActiveRun(sessionId)) {
        const waitForIdle = this.options.sessionManager.waitForIdle;
        if (!waitForIdle) throw new Error("Durable participation requires the session idle lifecycle.");
        let onAbort: (() => void) | undefined;
        const interrupted = new Promise<void>((resolve) => {
          onAbort = resolve;
          channel.abort.signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
          await Promise.race([waitForIdle.call(this.options.sessionManager, sessionId), interrupted]);
        } finally {
          if (onAbort) channel.abort.signal.removeEventListener("abort", onAbort);
        }
        if (channel.abort.signal.aborted || this.active.get(channel.kind) !== channel) return;
        continue;
      }
      const context = channel.adapter.conversationContext?.(participant.source);
      let next: AgentChannelObservedEvent | undefined =
        participant.pendingSequence === undefined ? undefined : store.event(participant.pendingSequence);
      if (next && !this.isHistoryEntryCurrent(channel.adapter, next.message)) {
        store.removeEvent(next.message.source, agentChannelHistoryEntryKey(next.message)!);
        continue;
      }
      for (const candidate of participant.status === "ready" ? [] : store.pending(sessionId)) {
        if (!this.isHistoryEntryCurrent(channel.adapter, candidate.message)) continue;
        if (candidate.message.task?.sessionId === sessionId) continue;
        if (context?.selfId && (candidate.message.event?.actorId ?? candidate.message.senderId) === context.selfId)
          continue;
        if (
          participant.status !== "waiting" ||
          matchesAgentChannelWait(participant, candidate.message, context?.selfId)
        ) {
          next = candidate;
          // Resume once for the accumulated inbox; the model reads all intervening events as needed.
        }
      }
      const due = participant.conditions?.wakeAt && Date.parse(participant.conditions.wakeAt) <= this.now().getTime();
      const scheduled =
        participant.status !== "ready" ? this.options.conversations?.next(sessionId, this.now()) : undefined;
      if (scheduled) next = store.event(scheduled.createdSequence);
      if (!next && !due && participant.status !== "ready") return;
      const reason = participant.wakeReason ?? (scheduled?.status === "waiting" ? "time" : next ? "event" : "time");
      const ready = store.ready(sessionId, reason, next?.sequence, scheduled);
      if (!ready.resumeRequestId) throw new Error("A ready channel participant has no continuation identity.");
      const conversationCurrent = this.conversationGuard.capture(serializeAgentChannelConversation(participant.source));
      const current = () =>
        this.started &&
        this.active.get(channel.kind) === channel &&
        this.isCurrentLane(participant.source, sessionId) &&
        store.get(sessionId) !== undefined &&
        store.get(sessionId)?.status !== "paused" &&
        channel.adapter.canParticipate?.(participant.source) !== false &&
        (!next || this.isHistoryEntryCurrent(channel.adapter, next.message)) &&
        conversationCurrent();
      const wake = {
        reason,
        ...(ready.conditions?.taskId ? { taskId: ready.conditions.taskId } : {}),
        ...(participant.waitId ? { waitId: participant.waitId } : {}),
        afterSequence: participant.cursor,
        ...(next ? { throughSequence: next.sequence } : {}),
      } as const;
      const inbox = this.readInbox(sessionId, channel, participant.cursor);
      // Admission alone is not a read receipt. A later model action or
      // successful completion acknowledges only the delivered inbox page.
      const message = next
        ? { ...next.message, source: { ...next.message.source, agentId: participant.source.agentId } }
        : undefined;
      const source = message?.source ?? { ...participant.source, messageId: undefined, displayName: undefined };
      const accepted = await this.submitToSession(
        channel,
        source,
        sessionId,
        reason === "time" || next?.message.event ? "" : (next?.message.text ?? ""),
        // Historical media belongs to its inbox event, not to this message.
        // Only the triggering message may own uploads in conversation history.
        reason === "time" ? undefined : next?.attachments,
        message,
        current,
        wake,
        ready.resumeRequestId,
        inbox,
      );
      if (!accepted) return;
      if (ready.conditions?.taskId && ready.scheduledRevision)
        this.options.conversations?.evaluated(
          sessionId,
          ready.conditions.taskId,
          ready.scheduledRevision,
          ready.resumeRequestId,
        );
    }
  }

  private restoreParticipation(kind: AgentChannelKind): void {
    this.active.get(kind)?.delivery.resume();
    if (this.options.ingress && !this.ingressPumps.has(kind)) {
      const recovery = this.restoreIngress(kind).finally(() => {
        this.ingressPumps.delete(kind);
      });
      this.ingressPumps.set(kind, recovery);
      void recovery.catch((error: unknown) =>
        this.log("error", "channels.ingress.recovery_failed", { kind, message: describe(error) }),
      );
    }
    void this.options.sessionManager.resumeQueuedMessages?.().catch((error: unknown) => {
      this.log("error", "channels.queued_input.recovery_failed", { kind, message: describe(error) });
    });
    for (const participant of this.options.participationStore?.list() ?? []) {
      if (participant.source.platform === kind) void this.pumpParticipant(participant.sessionId);
    }
    this.scheduleParticipationWake();
  }

  private async restoreIngress(kind: AgentChannelKind): Promise<void> {
    const channel = this.active.get(kind);
    if (!channel || channel.abort.signal.aborted || channel.adapter.getConnectionState() !== "connected") return;
    for (const entry of this.options.ingress?.pending(kind) ?? []) {
      if (channel.abort.signal.aborted) return;
      if (channel.adapter.getConnectionState(entry.message.source) !== "connected") continue;
      try {
        await this.handleInbound(channel, entry.message, entry);
      } catch (error) {
        this.log("error", "channels.ingress.failed", { kind, id: entry.id, message: describe(error) });
      }
    }
  }

  private scheduleParticipationWake(): void {
    clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
    if (!this.started) return;
    const now = this.now().getTime();
    const times = (this.options.participationStore?.list() ?? []).flatMap((participant) => {
      const channel = this.active.get(participant.source.platform);
      if (
        participant.status === "paused" ||
        channel?.adapter.getConnectionState(participant.source) !== "connected" ||
        this.participantPumps.has(participant.sessionId) ||
        !this.isCurrentLane(participant.source, participant.sessionId)
      )
        return [];
      const taskWake = this.options.conversations?.nextWake(participant.sessionId);
      return [
        ...(participant.status === "waiting" && participant.conditions?.wakeAt
          ? [Date.parse(participant.conditions.wakeAt)]
          : []),
        ...(taskWake === undefined ? [] : [taskWake]),
      ];
    });
    const next = times.sort((left, right) => left - right)[0];
    if (next === undefined) return;
    // Node timers accept a signed 32-bit delay. Long waits are re-armed from
    // their persisted wall-clock deadline, never silently shortened.
    this.wakeTimer = setTimeout(
      () => {
        for (const participant of this.options.participationStore?.list() ?? []) {
          if (
            (participant.status === "waiting" &&
              participant.conditions?.wakeAt &&
              Date.parse(participant.conditions.wakeAt) <= this.now().getTime()) ||
            (participant.status !== "paused" && this.options.conversations?.next(participant.sessionId, this.now()))
          )
            void this.pumpParticipant(participant.sessionId);
        }
        this.scheduleParticipationWake();
      },
      Math.min(Math.max(0, next - now), 2 ** 31 - 1),
    );
    this.wakeTimer.unref?.();
  }

  private async handleCommand(
    channel: ActiveChannel,
    source: AgentChannelSource,
    command: AgentChannelCommand,
    rawText?: string,
    message?: AgentChannelInboundMessage,
  ): Promise<void> {
    const handler = this.commandHandlers.get(command);
    if (!handler) {
      channel.delivery.enqueue(source, agentErrorMessage("channels.unknownCommand", { command }));
      return;
    }
    await handler({ channel, source, rawText, message });
  }

  private async handleNewCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const previous = await this.resolveLane(source, false);
    this.options.participationStore?.cancel(previous.sessionId);
    if (this.options.sessionManager.hasActiveRun(previous.sessionId)) {
      await this.options.sessionManager.requestActiveRunCancellation({ sessionId: previous.sessionId });
    }
    const lane = await this.resolveLane(source, true);
    channel.delivery.enqueue(source, agentErrorMessage("channels.newSession", { sessionId: lane.sessionId }));
  }

  private async handleStopCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const lane = await this.resolveLane(source, false);
    const waiting = this.options.participationStore?.get(lane.sessionId)?.status === "waiting";
    this.options.participationStore?.pause(lane.sessionId);
    this.options.conversations?.stop(lane.sessionId);
    const requested = await this.options.sessionManager.requestActiveRunCancellation({ sessionId: lane.sessionId });
    channel.delivery.enqueue(
      source,
      requested || waiting ? agentErrorMessage("channels.stopRequested") : agentErrorMessage("channels.noActiveRun"),
    );
  }

  private async handleStatusCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const lines = this.statuses.map(
      (status) =>
        `• ${status.kind}: ${
          status.connected
            ? agentErrorMessage("channels.statusConnected")
            : status.enabled
              ? agentErrorMessage("channels.statusOffline")
              : agentErrorMessage("channels.statusDisabled")
        }`,
    );
    channel.delivery.enqueue(source, `${agentErrorMessage("channels.statusReport")}\n${lines.join("\n")}`);
  }

  private async handleQueueCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const lane = await this.resolveLane(source, false);
    const active = this.options.sessionManager.hasActiveRun(lane.sessionId);
    channel.delivery.enqueue(
      source,
      active ? this.renderBusyLaneNotice(channel) : agentErrorMessage("channels.queueIdle"),
    );
  }

  private renderBusyLaneNotice(channel: ActiveChannel): string {
    return channel.config.busyMessageMode === AgentChannelBusyMessageModes.Steer
      ? agentErrorMessage("channels.busySteer")
      : agentErrorMessage("channels.busyFollowUp");
  }

  private async handleSteerCommand({ channel, source, rawText, message }: AgentChannelCommandContext): Promise<void> {
    const instruction = rawText ? commandArguments(rawText, channel.adapter.capabilities.commandPrefix) : "";
    if (!instruction) {
      channel.delivery.enqueue(source, agentErrorMessage("channels.steerUsage"));
      return;
    }
    const lane = await this.resolveLane(source, false);
    const conversationSpace = this.createConversationSpace(lane.sessionId, source);
    const steered = await this.options.sessionManager.steerActiveRun({
      sessionId: lane.sessionId,
      input: instruction,
      interaction: {
        surface: AgentInteractionSurfaces.Channel,
        ...(this.options.identities ? { actor: this.resolveActor(channel, source, message) } : {}),
        platform: source.platform,
        ...(channel.adapter.conversationContext ? { conversation: channel.adapter.conversationContext(source) } : {}),
        ...(message?.senderId ? { message: { senderId: message.senderId } } : {}),
        chatType: source.chatType,
        spaceId: conversationSpace.id,
        delivery: channel.adapter.capabilities.automaticDelivery === false ? "explicit" : "automatic",
        ...(conversationSpace.profileId ? { profileId: conversationSpace.profileId } : {}),
      },
    });
    channel.delivery.enqueue(
      source,
      steered ? agentErrorMessage("channels.steerInjected") : agentErrorMessage("channels.steerIdle"),
    );
  }

  private async handleHelpCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const busyHint =
      channel.config.busyMessageMode === AgentChannelBusyMessageModes.Steer
        ? agentErrorMessage("channels.busyHintSteer")
        : agentErrorMessage("channels.busyHintFollowUp");
    channel.delivery.enqueue(
      source,
      [
        agentErrorMessage("channels.helpIntro"),
        ...renderAgentChannelCommandHelp(channel.adapter.capabilities.commandPrefix),
        agentErrorMessage("channels.helpFooter"),
        busyHint,
      ].join("\n"),
    );
  }

  private createRunRenderer(
    channel: ActiveChannel,
    source: AgentChannelSource,
    requestId: string,
  ): AgentChannelRunRenderer | undefined {
    return channel.adapter.capabilities.automaticDelivery !== false
      ? new AgentChannelRunRenderer({
          adapter: channel.adapter,
          delivery: channel.delivery,
          source,
          streamProgress: channel.config.streamProgress !== false,
          resourceResolver: this.options.resourceResolver,
          requestId,
          onPreviewFailed: (error) =>
            this.log("warn", "channels.preview_failed", { kind: channel.kind, message: describe(error) }),
          onDeliveryFailed: (error) =>
            this.log("error", "channels.send_dropped", { kind: channel.kind, source, message: describe(error) }),
        })
      : undefined;
  }

  private createRunSink(
    channel: ActiveChannel,
    source: AgentChannelSource,
    sessionId: string,
    requestId: string,
    renderer?: AgentChannelRunRenderer,
    message?: AgentChannelInboundMessage,
    continuationRequestId?: string,
    inbox?: AgentInteractionInbox,
  ): AgentEventSyncer {
    return async (event) => {
      if (event.kind === AgentEventKinds.SessionMessageQueued) {
        this.bindInboundHistory(channel.adapter, source, message, { sessionId, requestId: event.data.parentRequestId });
      }
      const context = event.context as { requestId?: string } | undefined;
      if (context?.requestId && context.requestId !== requestId) return;
      if (continuationRequestId && event.kind === AgentEventKinds.RunStarted) {
        this.options.participationStore?.accept(sessionId, requestId);
      }
      const channelEvent = withEventContext(event, { scope: { channel: channel.kind } });
      await renderer?.handleEvent(channelEvent);
      await this.eventSink?.(channelEvent);
      if (isChannelTerminalEvent(channelEvent)) {
        this.inboxBatches.delete(sessionId);
        if (renderer) this.releaseRenderer(requestId, renderer);
        if (channelEvent.kind === AgentEventKinds.RunCancelled || channelEvent.kind === AgentEventKinds.RunFailed) {
          this.options.participationStore?.pause(sessionId, requestId);
        } else if (this.options.participationStore?.get(sessionId)) {
          this.observeInbox(
            { sessionId, requestId, interaction: { surface: AgentInteractionSurfaces.Channel, inbox } },
            channel,
          );
          void this.pumpParticipant(sessionId);
        }
      }
    };
  }

  queuedInputSink(
    input: import("../Session/AgentSessionQueuedInput.js").AgentSessionQueuedInput,
  ): AgentEventSyncer | undefined {
    const lane = this.options.mappingStore?.getBySession(input.sessionId);
    const channel = lane ? this.active.get(lane.platform) : undefined;
    if (
      !lane ||
      !channel ||
      channel.adapter.getConnectionState(lane) !== "connected" ||
      !authorizeChannelSource(channel.config, lane) ||
      !this.isCurrentLane(lane, input.sessionId) ||
      channel.adapter.canParticipate?.(lane) === false
    )
      return undefined;
    const source = { ...lane, messageId: input.request.interaction?.message?.id };
    let sink: AgentEventSyncer | undefined;
    return (event) => {
      if (!sink && event.kind === AgentEventKinds.RunStarted) {
        const renderer = this.createRunRenderer(channel, source, input.requestId);
        if (renderer) this.renderers.set(input.requestId, renderer);
        sink = this.createRunSink(
          channel,
          source,
          input.sessionId,
          input.requestId,
          renderer,
          undefined,
          undefined,
          input.request.interaction?.inbox,
        );
      }
      return sink ? sink(event) : this.eventSink?.(withEventContext(event, { scope: { channel: channel.kind } }));
    };
  }

  private async submitToSession(
    channel: ActiveChannel,
    source: AgentChannelSource,
    sessionId: string,
    input: string,
    attachments?: readonly AgentUploadAttachment[],
    message?: AgentChannelInboundMessage,
    current?: () => boolean,
    wake?: NonNullable<AgentInteractionContext["wake"]>,
    continuationRequestId?: string,
    inbox?: AgentInteractionInbox,
  ): Promise<boolean> {
    const messageKey = message ? agentChannelHistoryEntryKey(message) : undefined;
    const requestId =
      continuationRequestId ??
      (messageKey
        ? `channel_${sha256HexOfCanonicalJson({ sessionId, source: serializeAgentChannelLane(source), messageKey })}`
        : createOpaqueId("channel"));
    if (messageKey && !continuationRequestId && this.options.sessionManager.hasRequest?.(sessionId, requestId))
      return true;
    this.bindInboundHistory(channel.adapter, source, message, { sessionId, requestId });
    const conversationSpace = this.createConversationSpace(sessionId, source, `conversation:${source.platform}`);
    const automaticDelivery = channel.adapter.capabilities.automaticDelivery !== false;
    const conversation = channel.adapter.conversationContext?.(source);
    const senderKind = conversation?.participants.find((participant) => participant.id === message?.senderId)?.kind;
    const renderer = this.createRunRenderer(channel, source, requestId);
    const sink = this.createRunSink(
      channel,
      source,
      sessionId,
      requestId,
      renderer,
      message,
      continuationRequestId,
      inbox,
    );

    if (renderer) this.renderers.set(requestId, renderer);
    try {
      const approvalMode = this.options.approvalMode?.() ?? this.options.config().defaultApprovalMode ?? "agent";
      const submission = await this.options.sessionManager.acceptMessage({
        agentId: source.agentId ?? conversationSpace.profileId,
        sessionId,
        requestId,
        ...(conversationSpace.modelProviderId ? { modelProviderId: conversationSpace.modelProviderId } : {}),
        input,
        approvalMode,
        attachments: attachments ? [...attachments] : undefined,
        disposition: AgentSessionMessageDispositions.CreateIfMissing,
        admissionGuard: () => (current?.() ?? true) && this.isCurrentLane(source, sessionId),
        queueMode: AgentSessionQueueModeByBusyMessageMode[channel.config.busyMessageMode],
        onEvent: sink,
        metadata: {
          channel: {
            platform: channel.kind,
            chatType: source.chatType,
            chatId: source.chatId,
            ...(conversation ? { chatName: conversation.name } : {}),
            userId: source.userId,
            messageId: source.messageId,
            attachmentCount: attachments?.length ?? 0,
            spaceId: conversationSpace.id,
          },
        },
        interaction: {
          surface: AgentInteractionSurfaces.Channel,
          ...(this.options.identities
            ? {
                actor: message
                  ? this.resolveActor(channel, source, message)
                  : this.options.participationStore?.get(sessionId)?.actor,
              }
            : {}),
          ...(this.options.conversations ? { coordination: this.conversationState(sessionId, source) } : {}),
          platform: channel.kind,
          chatType: source.chatType,
          spaceId: conversationSpace.id,
          delivery: automaticDelivery ? "automatic" : "explicit",
          capabilities: channel.adapter.capabilitiesFor?.(source) ?? channel.adapter.capabilities,
          ...(wake ? { wake } : {}),
          ...(inbox ? { inbox } : {}),
          ...(conversation ? { conversation } : {}),
          ...(message?.event ? { event: message.event } : {}),
          ...(message && !message.event
            ? {
                message: {
                  ...(source.messageId ? { id: source.messageId } : {}),
                  ...(source.displayName ? { senderName: source.displayName } : {}),
                  ...(message.senderId ? { senderId: message.senderId } : {}),
                  ...(senderKind ? { senderKind } : {}),
                  ...(message.sentAt ? { sentAt: message.sentAt } : {}),
                  ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
                  ...(message.segments ? { segments: projectChannelMessageSegments(message, attachments) } : {}),
                },
              }
            : {}),
          ...(source.agentId || conversationSpace.profileId
            ? { profileId: source.agentId ?? conversationSpace.profileId }
            : {}),
        },
      });
      if (submission.kind === "accepted") {
        if (continuationRequestId) this.options.participationStore?.accept(sessionId, requestId);
        return true;
      } else {
        // The message never owned a turn: a queued message joins the active
        // run and its answer streams back with that run, a busy one was
        // dropped while the session stayed unavailable. Release the renderer
        // now instead of holding the reply window open until the safety
        // timeout; only a dropped submission needs a sender-facing notice.
        if (renderer) this.releaseRenderer(requestId, renderer);
        if (submission.kind === "queued") return true;
        if (submission.kind !== "superseded") {
          channel.delivery.enqueue(source, this.renderBusyLaneNotice(channel));
        }
      }
    } catch (error) {
      if (renderer) this.releaseRenderer(requestId, renderer);
      this.log("error", "channels.submit_failed", { kind: channel.kind, sessionId, message: describe(error) });
      channel.delivery.enqueue(source, agentErrorMessage("channels.submitFailed"));
    }
    return false;
  }

  private bindInboundHistory(
    adapter: AgentChannelAdapter | undefined,
    source: AgentChannelSource,
    message:
      | {
          readonly id?: string;
          readonly event?: import("./AgentChannelTypes.js").AgentChannelEvent;
          readonly source?: AgentChannelSource;
        }
      | undefined,
    task: AgentChannelTask,
    preserveExisting = false,
  ): void {
    const messageId = message?.source?.messageId ?? message?.id ?? source.messageId;
    const key = agentChannelHistoryEntryKey({ source: { ...source, messageId }, event: message?.event });
    if (key) {
      adapter?.bindHistory?.(source, key, task, preserveExisting);
      this.options.participationStore?.bind(source, key, task);
    }
  }

  private releaseRenderer(requestId: string, renderer: AgentChannelRunRenderer): void {
    renderer.dispose();
    this.renderers.delete(requestId);
  }

  private async handleInteraction(channel: ActiveChannel, interaction: AgentChannelInteraction): Promise<void> {
    if (!authorizeChannelSource(channel.config, interaction.source)) {
      this.log("warn", "channels.interaction_denied", { kind: channel.kind, chatId: interaction.source.chatId });
      return;
    }
    const data = interaction.buttonData?.trim() || interaction.buttonId?.trim();
    if (!data) return;
    const commandText = data.startsWith("command:")
      ? `${channel.adapter.capabilities.commandPrefix}${data.slice("command:".length)}`
      : data;
    const command = parseChannelCommand(commandText, channel.adapter.capabilities.commandPrefix);
    if (command) {
      await this.handleCommand(channel, interaction.source, command, commandText);
      return;
    }
    this.log("info", "channels.interaction_received", {
      kind: channel.kind,
      chatId: interaction.source.chatId,
      buttonId: interaction.buttonId,
    });
    await this.options.onInteraction?.(interaction);
  }

  /** Builds the durable completion port the orchestration delivery layer fans out to. */
  createCompletionPort(): AgentDelegationCompletionPort {
    return {
      id: "senera.channels.completion",
      completed: async (record: AgentChildRunRecord) => {
        await this.deliverCompletion(record);
      },
    };
  }

  /**
   * Projects a host-generated result into the channel lane that owns a session.
   * The session manager persists the result first; this method only handles the
   * platform delivery and reuses the ordinary final-answer renderer so text,
   * resources, and media keep their authored order.
   */
  async deliverProactiveResult(
    request: AgentChannelProactiveDeliveryRequest,
  ): Promise<"delivered" | "busy" | "missing"> {
    const store = this.options.mappingStore;
    if (!store) return "missing";
    const lane = store.getBySession(request.sessionId);
    if (!lane) return "missing";

    const channel = this.active.get(lane.platform);
    if (!channel || channel.abort.signal.aborted) {
      const configured = this.options.config().channels[lane.platform];
      return configured?.enabled ? "busy" : "missing";
    }
    if (channel.adapter.capabilities.automaticDelivery === false) return "missing";

    const source: AgentChannelSource = {
      ...(lane.authority ? { authority: lane.authority } : {}),
      platform: lane.platform,
      chatType: lane.chatType,
      chatId: lane.chatId,
      userId: lane.userId,
      threadId: lane.threadId,
    };
    const renderer = this.createRenderer(channel, source, request.deliveryId);
    try {
      const accepted = request.activity
        ? await renderer.deliverActivity(request.activity)
        : await renderer.deliverProactive(request.content);
      if (!accepted) {
        this.log("warn", "channels.proactive_delivery_backpressure", {
          kind: lane.platform,
          sessionId: request.sessionId,
          deliveryId: request.deliveryId,
        });
        return "busy";
      }
      return "delivered";
    } catch (error) {
      this.log("warn", "channels.proactive_delivery_failed", {
        kind: lane.platform,
        sessionId: request.sessionId,
        deliveryId: request.deliveryId,
        message: describe(error),
      });
      return "busy";
    } finally {
      renderer.dispose();
    }
  }

  private async deliverCompletion(record: AgentChildRunRecord): Promise<void> {
    const store = this.options.mappingStore;
    if (!store) return;
    const lane = store.getBySession(record.parentSessionId);
    if (!lane) return;
    const channel = this.active.get(lane.platform);
    if (!channel || channel.abort.signal.aborted) {
      this.log("warn", "channels.completion_channel_unavailable", { kind: lane.platform, runId: record.id });
      return;
    }
    if (channel.adapter.capabilities.automaticDelivery === false) return;
    const source: AgentChannelSource = {
      ...(lane.authority ? { authority: lane.authority } : {}),
      platform: lane.platform,
      chatType: lane.chatType,
      chatId: lane.chatId,
      userId: lane.userId,
      threadId: lane.threadId,
    };
    const renderer = this.createRenderer(channel, source, record.id);
    try {
      const accepted = await renderer.deliverProactive(
        agentErrorMessage("channels.taskCompleted", { summary: summarizeCompletion(record) }),
      );
      if (!accepted) {
        this.log("warn", "channels.completion_delivery_backpressure", {
          kind: lane.platform,
          runId: record.id,
        });
      }
    } catch (error) {
      this.log("warn", "channels.completion_delivery_failed", {
        kind: lane.platform,
        runId: record.id,
        message: describe(error),
      });
    } finally {
      renderer.dispose();
    }
  }

  private createRenderer(
    channel: ActiveChannel,
    source: AgentChannelSource,
    requestId?: string,
  ): AgentChannelRunRenderer {
    return new AgentChannelRunRenderer({
      adapter: channel.adapter,
      delivery: channel.delivery,
      source,
      streamProgress: false,
      resourceResolver: this.options.resourceResolver,
      requestId,
      onPreviewFailed: (error) =>
        this.log("warn", "channels.preview_failed", { kind: channel.kind, message: describe(error) }),
      onDeliveryFailed: (error) =>
        this.log("error", "channels.send_dropped", { kind: channel.kind, source, message: describe(error) }),
    });
  }

  private resolveProfileRoutes(): AgentProfileRouteRegistry | undefined {
    return this.options.config().profileRoutes;
  }

  private conversationAddress(source: AgentChannelSource) {
    return {
      ...(source.authority ? { authority: source.authority } : {}),
      surface: AgentInteractionSurfaces.Channel,
      platform: source.platform,
      chatType: source.chatType,
      chatId: source.chatId,
      userId: source.userId,
      ...(source.threadId ? { threadId: source.threadId } : {}),
    };
  }

  private createConversationSpace(
    sessionId: string,
    source: AgentChannelSource,
    cacheFamily = `conversation:${source.platform}`,
  ) {
    return createAgentConversationSpace({
      sessionId,
      address: this.conversationAddress(source),
      routes: this.resolveProfileRoutes(),
      cacheFamily,
    });
  }

  private log(level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>): void {
    this.options.onLog?.(level, message, details);
  }
}

function renderChannelInboundInput(message: AgentChannelInboundMessage): string {
  return message.event
    ? agentErrorMessage("channels.platformEvent", {
        type: message.event.type,
        actor: message.event.actorName ?? message.event.actorId,
      })
    : renderInboundInput(message.text, message.attachments);
}
