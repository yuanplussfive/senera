import { withEventContext, type AgentDomainEvent } from "../Events/AgentEvent.js";
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
  type AgentChannelConnectionState,
  type AgentChannelInboundMessage,
  type AgentChannelInteraction,
  type AgentChannelKind,
  type AgentChannelSource,
  type AgentChannelsConfig,
  type AgentChannelWebhookResponse,
} from "./AgentChannelTypes.js";
import type { AgentChannelSessionMappingStore } from "./AgentChannelSessionMappingStore.js";
import { AgentChannelDelivery } from "./AgentChannelDelivery.js";
import { AgentChannelRunRenderer } from "./AgentChannelRunRenderer.js";
import type { AgentChannelAdapterRegistry } from "./AgentChannelAdapterRegistry.js";
import { resolveAgentChannelSessionId, serializeAgentChannelLane } from "./AgentChannelSessionIdentity.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import { renderAgentChannelCommandHelp, resolveAgentChannelCommand } from "./AgentChannelCommandRegistry.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentChannelFinalResponseRewriter } from "./AgentChannelFinalResponse.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { createAgentPiLogicalCacheScope } from "../Pi/AgentPiPromptCache.js";
import type { AgentChannelFinalizationRecord } from "./AgentChannelFinalizationTypes.js";

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
  submitMessage(request: {
    sessionId: string;
    requestId?: string;
    input: string;
    approvalMode: AgentExecutionApprovalMode;
    attachments?: AgentUploadAttachment[];
    disposition: (typeof AgentSessionMessageDispositions)[keyof typeof AgentSessionMessageDispositions];
    queueMode?: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSyncer;
    metadata?: Record<string, unknown>;
    interaction?: AgentInteractionContext;
  }): Promise<AgentSessionMessageAcceptance>;
  cancelActiveRun(request: { sessionId: string; requestId?: string; onEvent?: AgentEventSyncer }): Promise<boolean>;
  requestActiveRunCancellation(request: {
    sessionId: string;
    requestId?: string;
    onEvent?: AgentEventSyncer;
  }): Promise<boolean>;
  steerActiveRun(request: {
    sessionId: string;
    input: string;
    interaction?: AgentInteractionContext;
  }): Promise<boolean>;
  hasActiveRun(sessionId: string): boolean;
  /** Optional on lightweight hosts; the production manager persists this in SQLite. */
  loadChannelFinalizationContext?(
    sessionId: string,
    platform?: AgentChannelKind,
  ): Promise<readonly AgentChannelFinalizationRecord[]>;
  recordChannelFinalization?(sessionId: string, record: AgentChannelFinalizationRecord): Promise<void>;
}

export interface AgentEventSyncer {
  (event: AgentDomainEvent): void | Promise<void>;
}

export interface AgentChannelServiceOptions {
  readonly config: () => AgentChannelsConfig;
  readonly registry: AgentChannelAdapterRegistry;
  readonly sessionManager: AgentChannelSessionPort;
  readonly mappingStore?: AgentChannelSessionMappingStore;
  /** Stores inbound channel media so vision/audio-capable runs can resolve it. */
  readonly attachmentResolver?: (
    attachment: AgentChannelAttachment,
    source: AgentChannelSource,
    requestHeaders?: Readonly<Record<string, string>>,
  ) => Promise<AgentUploadAttachment | undefined>;
  /** Resolves durable Senera resources for native outbound channel media. */
  readonly resourceResolver?: AgentResourceResolverLike;
  /** Serializes every channel terminal answer into ordered delivery parts. */
  readonly finalResponseRewriter?: AgentChannelFinalResponseRewriter;
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
}

export interface AgentChannelProactiveDeliveryRequest {
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly createdAt: string;
}

interface ActiveChannel {
  readonly kind: AgentChannelKind;
  readonly config: AgentChannelConfig;
  readonly adapter: AgentChannelAdapter;
  readonly delivery: AgentChannelDelivery;
  readonly abort: AbortController;
  error?: string;
}

interface AgentChannelCommandContext {
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
export class AgentChannelService {
  private readonly options: AgentChannelServiceOptions;
  private readonly active = new Map<AgentChannelKind, ActiveChannel>();
  private readonly renderers = new Map<string, AgentChannelRunRenderer>();
  /** Keeps command/session behavior correct for lightweight hosts without a database store. */
  private readonly ephemeralLanes = new Map<string, { sessionId: string; epoch: number }>();
  private readonly commandHandlers: ReadonlyMap<AgentChannelCommand, AgentChannelCommandHandler>;
  private startController?: AbortController;
  private started = false;
  private readonly now: () => Date;
  private eventSink?: AgentEventSyncer;
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
      };
    });
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
    this.startController = new AbortController();
    const channelsConfig = this.options.config();
    if (!channelsConfig.enabled) {
      this.log("info", "channels.disabled");
      this.options.onStatusChanged?.(this.statuses);
      return;
    }
    const failures: string[] = [];
    for (const kind of this.options.registry.kinds()) {
      await this.startChannel(kind, channelsConfig.channels[kind], failures);
    }
    this.options.onStatusChanged?.(this.statuses);
    if (failures.length > 0) {
      this.log("error", "channels.partial_failure", { failures });
    }
  }

  private async stopNow(): Promise<void> {
    this.started = false;
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
    this.ephemeralLanes.clear();
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
      },
      onFatal: (error) => {
        if (this.active.get(kind) !== channel) return;
        this.log("error", "channels.adapter_fatal", { kind, message: describe(error) });
        channel.error = describe(error);
        this.options.onStatusChanged?.(this.statuses);
      },
      onInteraction: (interaction) => this.handleInteraction(channel, interaction),
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
    } catch (error) {
      channel.error = describe(error);
      this.log("error", "channels.connect_failed", { kind, message: describe(error) });
      // The adapter remains registered so a later reconnect attempt can reuse
      // its state; delivery for this channel fails closed with logged errors.
    }
    return channel;
  }

  private async handleInbound(channel: ActiveChannel, message: AgentChannelInboundMessage): Promise<void> {
    const { source, text } = message;
    const trimmed = text.trim();
    const input = renderInboundInput(trimmed, message.attachments);
    if (!input) return;

    if (!this.authorizeSource(channel, source)) {
      this.log("warn", "channels.message_denied", { kind: channel.kind, chatId: source.chatId });
      channel.delivery.enqueue(source, agentErrorMessage("channels.denied"));
      return;
    }

    const command = parseChannelCommand(trimmed, channel.adapter.capabilities.commandPrefix);
    if (command) {
      await this.handleCommand(channel, source, command, trimmed);
      return;
    }

    // QQ's input-notify is a best-effort presence signal. Start it after
    // command routing so /stop and /status do not flash a typing indicator.
    const typing = channel.adapter.sendTyping?.(source);
    void typing?.catch(() => undefined);

    const lane = await this.resolveLane(source, false);
    const attachments = await this.resolveInboundAttachments(source, message.attachments);
    await this.submitToSession(channel, source, lane.sessionId, input, attachments);
  }

  private async resolveInboundAttachments(
    source: AgentChannelSource,
    attachments: readonly AgentChannelAttachment[] | undefined,
  ): Promise<AgentUploadAttachment[] | undefined> {
    if (!attachments?.length || !this.options.attachmentResolver) return undefined;
    const resolved: AgentUploadAttachment[] = [];
    for (const attachment of attachments) {
      try {
        const requestHeaders = await this.active
          .get(source.platform)
          ?.adapter.getInboundAttachmentHeaders?.(attachment, source);
        const uploaded = await this.options.attachmentResolver(attachment, source, requestHeaders);
        if (uploaded) resolved.push(uploaded);
      } catch (error) {
        this.log("warn", "channels.attachment_ingest_failed", {
          kind: source.platform,
          chatId: source.chatId,
          name: attachment.filename,
          message: describe(error),
        });
      }
    }
    return resolved.length > 0 ? resolved : undefined;
  }

  private authorizeSource(channel: ActiveChannel, source: AgentChannelSource): boolean {
    const config = channel.config;
    if (config.allowAllUsers === true) return true;
    const isDirect = source.chatType === "direct";
    const policy = isDirect ? config.dmPolicy : config.groupPolicy;
    const allowed = !isDirect
      ? [...(config.groupAllowedUsers ?? []), ...(config.allowedUsers ?? [])]
      : config.allowedUsers;
    if (policy === "open") return true;
    if (policy === "disabled" || policy === "pairing") return false;
    return (
      Array.isArray(allowed) && allowed.some((candidate) => candidate === source.chatId || candidate === source.userId)
    );
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

  private async handleCommand(
    channel: ActiveChannel,
    source: AgentChannelSource,
    command: AgentChannelCommand,
    rawText?: string,
  ): Promise<void> {
    const handler = this.commandHandlers.get(command);
    if (!handler) {
      channel.delivery.enqueue(source, agentErrorMessage("channels.unknownCommand", { command }));
      return;
    }
    await handler({ channel, source, rawText });
  }

  private async handleNewCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const lane = await this.resolveLane(source, true);
    channel.delivery.enqueue(source, agentErrorMessage("channels.newSession", { sessionId: lane.sessionId }));
  }

  private async handleStopCommand({ channel, source }: AgentChannelCommandContext): Promise<void> {
    const lane = await this.resolveLane(source, false);
    const requested = await this.options.sessionManager.requestActiveRunCancellation({ sessionId: lane.sessionId });
    channel.delivery.enqueue(
      source,
      requested ? agentErrorMessage("channels.stopRequested") : agentErrorMessage("channels.noActiveRun"),
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

  private async handleSteerCommand({ channel, source, rawText }: AgentChannelCommandContext): Promise<void> {
    const instruction = rawText ? commandArguments(rawText, channel.adapter.capabilities.commandPrefix) : "";
    if (!instruction) {
      channel.delivery.enqueue(source, agentErrorMessage("channels.steerUsage"));
      return;
    }
    const lane = await this.resolveLane(source, false);
    const steered = await this.options.sessionManager.steerActiveRun({
      sessionId: lane.sessionId,
      input: instruction,
      interaction: { surface: "channel", platform: channel.kind, chatType: source.chatType },
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

  private async submitToSession(
    channel: ActiveChannel,
    source: AgentChannelSource,
    sessionId: string,
    input: string,
    attachments?: readonly AgentUploadAttachment[],
  ): Promise<void> {
    const requestId = `channel_${createShortId()}`;
    const logicalCacheScope = createAgentPiLogicalCacheScope({
      sessionId,
      family: `channel-finalization:${source.platform}`,
    });
    const finalizationHistory = await this.loadFinalizationHistory(sessionId, channel.kind);
    const renderer = new AgentChannelRunRenderer({
      adapter: channel.adapter,
      delivery: channel.delivery,
      source,
      streamProgress: channel.config.streamProgress !== false,
      resourceResolver: this.options.resourceResolver,
      finalResponseRewriter: this.options.finalResponseRewriter,
      sessionId,
      requestId,
      logicalCacheScope,
      finalizationHistory,
      onFinalized: (record) => this.options.sessionManager.recordChannelFinalization?.(sessionId, record),
      onPreviewFailed: (error) =>
        this.log("warn", "channels.preview_failed", { kind: channel.kind, message: describe(error) }),
      onMediaFailed: (error) =>
        this.log("warn", "channels.media_projection_failed", { kind: channel.kind, message: describe(error) }),
      onFinalRewriteFailed: (error) =>
        this.log("warn", "channels.final_rewrite_failed", { kind: channel.kind, message: describe(error) }),
      onFinalRewriteTiming: (timing) =>
        this.log("info", "channels.final_rewrite_timing", { kind: channel.kind, ...timing }),
      onFinalizationPersistFailed: (error) =>
        this.log("warn", "channels.finalization_persist_failed", { kind: channel.kind, message: describe(error) }),
    });
    let finished: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const sink: AgentEventSyncer = async (event) => {
      const context = event.context as { requestId?: string } | undefined;
      if (context?.requestId !== requestId) return;
      const channelEvent = withEventContext(event, { scope: { channel: channel.kind } });
      await renderer.handleEvent(channelEvent);
      await this.eventSink?.(channelEvent);
      if (isChannelTerminalEvent(channelEvent)) {
        this.releaseRenderer(requestId, renderer);
        finished?.();
      }
    };
    this.renderers.set(requestId, renderer);
    try {
      const approvalMode = this.options.approvalMode?.() ?? this.options.config().defaultApprovalMode ?? "agent";
      const submission = await this.options.sessionManager.submitMessage({
        sessionId,
        requestId,
        input,
        approvalMode,
        attachments: attachments ? [...attachments] : undefined,
        disposition: AgentSessionMessageDispositions.CreateIfMissing,
        queueMode: AgentSessionQueueModeByBusyMessageMode[channel.config.busyMessageMode],
        onEvent: sink,
        metadata: {
          channel: {
            platform: channel.kind,
            chatType: source.chatType,
            chatId: source.chatId,
            userId: source.userId,
            messageId: source.messageId,
            attachmentCount: attachments?.length ?? 0,
          },
        },
        interaction: { surface: "channel", platform: channel.kind, chatType: source.chatType },
      });
      if (submission.kind === "accepted") {
        await Promise.race([terminal, timeout(this.replyTimeoutMs(channel))]);
      } else {
        // The message never owned a turn: a queued message joins the active
        // run and its answer streams back with that run, a busy one was
        // dropped while the session stayed unavailable. Release the renderer
        // now instead of holding the reply window open until the safety
        // timeout; only a dropped submission needs a sender-facing notice.
        this.releaseRenderer(requestId, renderer);
        if (submission.kind !== "queued") {
          channel.delivery.enqueue(source, this.renderBusyLaneNotice(channel));
        }
      }
    } catch (error) {
      this.releaseRenderer(requestId, renderer);
      this.log("error", "channels.submit_failed", { kind: channel.kind, sessionId, message: describe(error) });
      channel.delivery.enqueue(source, agentErrorMessage("channels.submitFailed"));
    }
    finished?.();
  }

  private releaseRenderer(requestId: string, renderer: AgentChannelRunRenderer): void {
    renderer.dispose();
    this.renderers.delete(requestId);
  }

  private async handleInteraction(channel: ActiveChannel, interaction: AgentChannelInteraction): Promise<void> {
    if (!this.authorizeSource(channel, interaction.source)) {
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

  private replyTimeoutMs(channel: ActiveChannel): number {
    const value = channel.config.unknown?.replyTimeoutMs;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 10 * 60_000;
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

    const source: AgentChannelSource = {
      platform: lane.platform,
      chatType: lane.chatType,
      chatId: lane.chatId,
      userId: lane.userId,
      threadId: lane.threadId,
    };
    const finalizationHistory = await this.loadFinalizationHistory(request.sessionId, lane.platform);
    const renderer = this.createRenderer(channel, source, request.sessionId, request.deliveryId, finalizationHistory);
    try {
      const accepted = await renderer.deliverProactive(request.content);
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
    const source: AgentChannelSource = {
      platform: lane.platform,
      chatType: lane.chatType,
      chatId: lane.chatId,
      userId: lane.userId,
      threadId: lane.threadId,
    };
    const finalizationHistory = await this.loadFinalizationHistory(record.parentSessionId, lane.platform);
    const renderer = this.createRenderer(channel, source, record.parentSessionId, record.id, finalizationHistory);
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
    sessionId?: string,
    requestId?: string,
    finalizationHistory: readonly AgentChannelFinalizationRecord[] = [],
  ): AgentChannelRunRenderer {
    const logicalCacheScope = sessionId
      ? createAgentPiLogicalCacheScope({ sessionId, family: `channel-finalization:${source.platform}` })
      : undefined;
    return new AgentChannelRunRenderer({
      adapter: channel.adapter,
      delivery: channel.delivery,
      source,
      streamProgress: false,
      resourceResolver: this.options.resourceResolver,
      finalResponseRewriter: this.options.finalResponseRewriter,
      sessionId,
      requestId,
      logicalCacheScope,
      finalizationHistory,
      onFinalized: (record) =>
        sessionId ? this.options.sessionManager.recordChannelFinalization?.(sessionId, record) : undefined,
      onPreviewFailed: (error) =>
        this.log("warn", "channels.preview_failed", { kind: channel.kind, message: describe(error) }),
      onMediaFailed: (error) =>
        this.log("warn", "channels.media_projection_failed", { kind: channel.kind, message: describe(error) }),
      onFinalRewriteFailed: (error) =>
        this.log("warn", "channels.final_rewrite_failed", { kind: channel.kind, message: describe(error) }),
      onFinalRewriteTiming: (timing) =>
        this.log("info", "channels.final_rewrite_timing", { kind: channel.kind, ...timing }),
      onFinalizationPersistFailed: (error) =>
        this.log("warn", "channels.finalization_persist_failed", { kind: channel.kind, message: describe(error) }),
    });
  }

  private async loadFinalizationHistory(
    sessionId: string,
    kind: AgentChannelKind,
  ): Promise<readonly AgentChannelFinalizationRecord[]> {
    try {
      return (await this.options.sessionManager.loadChannelFinalizationContext?.(sessionId, kind)) ?? [];
    } catch (error) {
      this.log("warn", "channels.finalization_context_load_failed", {
        kind,
        sessionId,
        message: describe(error),
      });
      return [];
    }
  }

  private log(level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>): void {
    this.options.onLog?.(level, message, details);
  }
}

export function parseChannelCommand(text: string, prefix: string): AgentChannelCommand | undefined {
  if (!prefix || !text.startsWith(prefix)) return undefined;
  const body = text.slice(prefix.length).split(/\s+/)[0] ?? "";
  const command = body.split("@")[0]?.toLowerCase();
  if (!command || command.length === 0) return undefined;
  return resolveAgentChannelCommand(command);
}

function commandArguments(text: string, prefix: string): string {
  const body = prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return body.replace(/^\S+\s*/, "").trim();
}

function renderInboundInput(text: string, attachments?: readonly AgentChannelAttachment[]): string {
  const media =
    attachments?.flatMap((attachment) => {
      const name = attachment.filename || attachment.contentType || "媒体附件";
      const target = attachment.url ? `：${attachment.url}` : "";
      const transcript = attachment.transcript?.trim();
      return [`[${name}${target}]`, ...(transcript ? [`[语音转写：${transcript}]`] : [])];
    }) ?? [];
  const parts = [text, ...media].filter((part) => part.length > 0);
  return parts.join("\n").trim();
}

export function isChannelTerminalEvent(event: AgentDomainEvent): boolean {
  const kinds = new Set(["run.completed", "run.failed", "run.cancelled"]);
  return kinds.has(event.kind);
}

export function summarizeCompletion(record: AgentChildRunRecord): string {
  if (record.error) return `任务 ${record.task} 失败：${record.error}`;
  const answer = record.finalAnswer?.trim() || "（无最终回答）";
  return `任务：${record.task}\n${answer}`;
}

function createShortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
