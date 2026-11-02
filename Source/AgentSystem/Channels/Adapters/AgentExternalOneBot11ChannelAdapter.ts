import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CQCode } from "@onebots/protocol-onebot-v11";
import type { CommonTypes } from "onebots";
import type {
  AgentChannelAdapter,
  AgentChannelAdapterHandlers,
  AgentChannelAttachment,
  AgentChannelConnectionState,
  AgentChannelInboundMessage,
  AgentChannelMedia,
  AgentChannelSource,
  AgentChannelSendReplyOptions,
  AgentChannelSendResult,
} from "../AgentChannelTypes.js";
import type { AgentChannelParticipationStore } from "../AgentChannelParticipationStore.js";
import { AgentChannelKinds } from "../AgentChannelTypes.js";
import { AgentChannelCommandRegistry } from "../AgentChannelCommandRegistry.js";
import { authorizeChannelSource } from "../AgentChannelServiceHelpers.js";
import { AgentOneBot11ClientTransport, oneBot11Record } from "./AgentOneBot11ClientTransport.js";
import {
  AgentOneBot11Capabilities,
  agentOneBot11Authority,
  oneBot11Id,
  oneBot11WireId,
  type AgentOneBot11ConnectionConfig,
} from "./AgentOneBot11ConnectionConfig.js";
import {
  cloneOneBot11Segments,
  projectOneBot11InboundMessage,
  projectOneBot11OutboundMessage,
} from "./AgentOneBot11MessageProjection.js";

/** An external account uses the host inbox, uploads and outbox, never the virtual QQ store. */
export class AgentExternalOneBot11ChannelAdapter implements AgentChannelAdapter {
  readonly kind = AgentChannelKinds.OneBot;
  readonly capabilities = AgentOneBot11Capabilities;
  private handlers?: AgentChannelAdapterHandlers;
  private state: AgentChannelConnectionState = "stopped";
  private selfId?: string;
  private selfName = "";
  private error?: string;
  private readonly members = new Map<string, Map<string, string>>();
  private readonly transport: AgentOneBot11ClientTransport;

  constructor(
    private readonly config: AgentOneBot11ConnectionConfig,
    private readonly journal: AgentChannelParticipationStore,
  ) {
    this.transport = new AgentOneBot11ClientTransport(config, {
      login: (value) => {
        const login = oneBot11Record(value);
        const selfId = oneBot11Id(login.user_id);
        if (config.expectedSelfId && selfId !== config.expectedSelfId)
          throw new Error("OneBot login does not match expectedSelfId.");
        if (config.ownerQq === selfId) throw new Error("The owner QQ must differ from the bot account.");
        const changed = this.selfId !== undefined && this.selfId !== selfId;
        if (this.selfId !== selfId) this.members.clear();
        this.selfId = selfId;
        this.selfName = name(login.nickname) ?? selfId;
        if (changed)
          void Promise.resolve()
            .then(() => this.handlers?.onParticipantsChanged?.())
            .catch((error: unknown) => this.handlers?.onFatal(error, this.kind));
        return selfId;
      },
      status: (value) => this.updateStatus(value),
      event: (event) => this.receive(event),
      state: (state) => this.setState(state),
      error: (error) => {
        this.error = error instanceof Error ? error.message : String(error);
        this.handlers?.onFatal(new Error(`OneBot 11: ${this.error}`), this.kind);
      },
    });
  }

  owns(source: AgentChannelSource): boolean {
    return (
      source.platform === this.kind &&
      this.selfId !== undefined &&
      source.authority === agentOneBot11Authority(this.selfId)
    );
  }
  bind(handlers: AgentChannelAdapterHandlers): void {
    this.handlers = handlers;
  }
  async connect(signal: AbortSignal): Promise<void> {
    this.transport.start(signal);
  }
  async disconnect(): Promise<void> {
    await this.transport.stop();
  }
  getConnectionState(source?: AgentChannelSource): AgentChannelConnectionState {
    return source && !this.owns(source) ? "stopped" : this.state;
  }
  capabilitiesFor() {
    return {
      ...this.capabilities,
      supportsPoke: this.config.poke,
      mediaKinds: this.config.fileMessages
        ? (["image", "audio", "video", "file"] as const)
        : (["image", "audio", "video"] as const),
    };
  }
  getConnectionInfo() {
    const endpoint = new URL(this.config.wsUrl);
    endpoint.search = "";
    return {
      endpoint: endpoint.toString(),
      accountId: this.selfId,
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  resolveActor(senderId: string) {
    const self = senderId === this.selfId;
    return {
      authority: self ? "onebot11-bot" : "qq-account",
      account: oneBot11Id(senderId),
      kind: self ? ("agent" as const) : ("user" as const),
    };
  }
  canParticipate(source: AgentChannelSource): boolean {
    return (
      this.owns(source) &&
      ((source.chatType === "direct" && source.userId === this.config.ownerQq) ||
        authorizeChannelSource(this.config, source))
    );
  }
  isHistoryEntryCurrent(source: AgentChannelSource, key: string): boolean {
    return this.owns(source) && !this.journal.isRecalled(source, key);
  }
  routeInbound(message: AgentChannelInboundMessage): readonly AgentChannelSource[] {
    return this.canParticipate(message.source) ? [message.source] : [];
  }
  observeInbound(message: AgentChannelInboundMessage) {
    return this.routeInbound(message);
  }
  routeCommand(message: AgentChannelInboundMessage) {
    return this.routeInbound(message);
  }
  canExecuteCommand(
    message: AgentChannelInboundMessage,
    command: import("../AgentChannelTypes.js").AgentChannelCommand,
  ): boolean {
    return (
      message.source.chatType === "direct" ||
      AgentChannelCommandRegistry.find((entry) => entry.command === command)?.access === "read" ||
      (message.senderId !== undefined && message.senderId === this.config.ownerQq) ||
      (message.senderId !== undefined && this.config.commandUsers.includes(message.senderId))
    );
  }
  conversationContext(source: AgentChannelSource) {
    this.requireSource(source);
    return {
      id: source.chatId,
      name: source.displayName ?? source.chatId,
      selfId: this.selfId!,
      ...(this.config.ownerQq ? { ownerId: this.config.ownerQq } : {}),
      participants: [
        { id: this.selfId!, name: this.selfName, kind: "agent" as const, enabled: true },
        ...[...(this.members.get(this.memberKey(source)) ?? [])]
          .filter(([id]) => id !== this.selfId)
          .map(([id, memberName]) => ({ id, name: memberName, kind: "user" as const, enabled: true })),
      ],
    };
  }
  async readClientTimeline(source: AgentChannelSource, before?: number, limit?: number) {
    this.requireSource(source);
    return this.journal.archive(source, before, limit);
  }
  resolveMessageTasks(source: AgentChannelSource, messageId: string) {
    this.requireSource(source);
    return this.journal.messageTasks(source, messageId);
  }
  resolveMessageTask(source: AgentChannelSource, messageId: string) {
    const tasks = this.resolveMessageTasks(source, messageId);
    return tasks.length === 1 ? tasks[0] : undefined;
  }

  async send(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult> {
    this.requireSource(source);
    const parts = options?.parts ?? [
      ...(content ? [{ kind: "text" as const, content }] : []),
      ...(options?.media ?? []).map((media) => ({ kind: "media" as const, media })),
    ];
    const wireParts = await Promise.all(
      parts.map(async (part) =>
        part.kind === "text"
          ? part
          : {
              kind: "media" as const,
              media: await this.prepareMedia(part.media),
            },
      ),
    );
    const message = projectOneBot11OutboundMessage({
      text: content,
      parts: wireParts,
      replyToMessageId: options?.replyToMessageId,
      mentionIds: options?.mentionIds,
    });
    this.requireSource(source);
    const result = await this.transport.action(source.chatType === "group" ? "send_group_msg" : "send_private_msg", {
      [source.chatType === "group" ? "group_id" : "user_id"]: oneBot11WireId(source.chatId),
      message,
    });
    // A committed send without a native message ID cannot be retried safely.
    try {
      return { kind: "sent", messageId: oneBot11Id(oneBot11Record(result).message_id) };
    } catch {
      throw Object.assign(new Error("OneBot send returned no valid native message receipt."), { code: "ECONNRESET" });
    }
  }
  async deleteMessage(source: AgentChannelSource, messageId: string): Promise<AgentChannelSendResult> {
    this.requireSource(source);
    await this.transport.action("delete_msg", { message_id: oneBot11WireId(messageId) });
    return { kind: "deleted" };
  }
  async poke(source: AgentChannelSource, _task?: unknown, targetId?: string): Promise<void> {
    this.requireSource(source);
    if (!this.config.poke)
      throw Object.assign(new Error("This connection has not enabled the send_poke extension."), { retryable: false });
    await this.transport.action("send_poke", {
      user_id: oneBot11WireId(targetId ?? source.userId),
      ...(source.chatType === "group" ? { group_id: oneBot11WireId(source.chatId) } : {}),
    });
  }

  async resolveInboundAttachment(
    attachment: AgentChannelAttachment,
    source: AgentChannelSource,
    segments?: AgentChannelInboundMessage["segments"],
  ): Promise<AgentChannelAttachment> {
    this.requireSource(source);
    if (!attachment.nativeId) return attachment;
    const actions: Readonly<Partial<Record<NonNullable<AgentChannelAttachment["mediaType"]>, string>>> = {
      image: "get_image",
      audio: "get_record",
      file: source.chatType === "group" ? "get_group_file_url" : "get_file",
    };
    const action = attachment.mediaType && actions[attachment.mediaType];
    if (!action)
      throw new Error(`OneBot ${attachment.mediaType} has no readable URL; this gateway must supply its download URL.`);
    const nativeSegment = segments?.find((segment) => segment.data.attachmentId === attachment.id);
    const busid = nativeSegment?.data.busid;
    const parameters =
      attachment.mediaType === "file"
        ? {
            file_id: attachment.nativeId,
            ...(source.chatType === "group" ? { group_id: oneBot11WireId(source.chatId) } : {}),
            ...(typeof busid === "number" && Number.isSafeInteger(busid) ? { busid } : {}),
          }
        : { file: attachment.nativeId, ...(attachment.mediaType === "audio" ? { out_format: "mp3" } : {}) };
    const resolved = oneBot11Record(await this.transport.action(action, parameters));
    const url = [resolved.url, resolved.file].find(
      (value): value is string => typeof value === "string" && /^https?:\/\//u.test(value),
    );
    if (!url)
      throw new Error("OneBot returned a gateway-local file path; a remote attachment needs a downloadable URL.");
    return { ...attachment, url };
  }

  private async prepareMedia(media: AgentChannelMedia): Promise<AgentChannelMedia> {
    if (media.kind === "file" && !this.config.fileMessages)
      throw Object.assign(new Error("This connection has not enabled the file-message extension."), {
        retryable: false,
      });
    if (media.url && /^https?:\/\//u.test(media.url)) return media;
    if (media.path)
      return {
        ...media,
        url: undefined,
        path: undefined,
        data: `base64://${(await readFile(media.path)).toString("base64")}`,
      };
    if (media.data) {
      const data = media.data.replace(/^data:[^,]*;base64,/u, "base64://");
      if (!data.startsWith("base64://")) throw new Error("OneBot inline media must use base64 encoding.");
      return { ...media, url: undefined, data };
    }
    throw new Error("The external OneBot gateway requires media bytes or an HTTP download URL.");
  }

  private async receive(payload: Record<string, unknown>): Promise<void> {
    if (payload.post_type === "meta_event") {
      if (payload.meta_event_type === "heartbeat") this.updateStatus(payload.status);
      return;
    }
    if (payload.post_type !== "message" && payload.post_type !== "notice") return;
    const senderId = oneBot11Id(payload.user_id);
    if (senderId === this.selfId && payload.post_type === "message") return;
    const chatType = payload.group_id !== undefined ? "group" : "direct";
    const counterpartId =
      payload.post_type === "notice" && senderId === this.selfId && payload.target_id !== undefined
        ? oneBot11Id(payload.target_id)
        : senderId;
    const chatId = chatType === "group" ? oneBot11Id(payload.group_id) : counterpartId;
    const source: AgentChannelSource = {
      platform: this.kind,
      authority: agentOneBot11Authority(this.selfId!),
      chatType,
      chatId,
      userId: chatType === "group" ? chatId : counterpartId,
    };
    if (!this.canParticipate(source)) return;
    const sentAt = eventTime(payload.time);
    const roster = this.members.get(this.memberKey(source)) ?? new Map<string, string>();
    const sender = payload.sender ? oneBot11Record(payload.sender) : {};
    roster.set(senderId, name(sender.card) ?? name(sender.nickname) ?? senderId);
    this.members.set(this.memberKey(source), roster);
    if (payload.post_type === "notice") {
      await this.receiveNotice(source, payload, senderId, sentAt);
      return;
    }
    if (payload.message_type !== "private" && payload.message_type !== "group")
      throw new Error("Unsupported OneBot message_type.");
    const messageId = oneBot11Id(payload.message_id);
    const segments = wireSegments(payload.message);
    const projection = projectOneBot11InboundMessage(segments, { origin: "external" });
    const replied = projection.replyToMessageId
      ? this.journal.message(source, projection.replyToMessageId)?.message
      : undefined;
    const message: AgentChannelInboundMessage = {
      source: { ...source, messageId, ...(chatType === "direct" ? { displayName: roster.get(senderId) } : {}) },
      senderId,
      ...projection,
      sentAt,
      ...(replied?.senderId ? { replyToSenderId: replied.senderId } : {}),
      addressedToSelf: segments.some((segment) => segment.type === "at" && String(segment.data.qq) === this.selfId),
    };
    // Capture the original event before any optional roster query or media resolution.
    await this.handlers?.onMessage(message);
    if (chatType === "group" && roster.size === 1) {
      try {
        await this.refreshMembers(source);
      } catch (error) {
        this.handlers?.onFatal(error, this.kind);
      }
    }
  }

  private async receiveNotice(
    source: AgentChannelSource,
    payload: Record<string, unknown>,
    actorId: string,
    sentAt: string,
  ) {
    if (payload.notice_type === "group_upload" || payload.notice_type === "offline_file") {
      const file = oneBot11Record(payload.file);
      const locator = payload.notice_type === "group_upload" ? file.id : file.url;
      if (typeof locator !== "string" && typeof locator !== "number")
        throw new Error("OneBot group files require an ID; offline files require a download URL.");
      const projection = projectOneBot11InboundMessage(
        [
          {
            type: "file",
            data: {
              ...file,
              file: String(locator),
              ...(file.name ? { name: file.name } : {}),
            },
          },
        ],
        { origin: "external" },
      );
      const id = createHash("sha256")
        .update(
          JSON.stringify([
            source.authority,
            source.chatType,
            source.chatId,
            payload.notice_type,
            payload.time,
            actorId,
            locator,
          ]),
        )
        .digest("hex");
      await this.handlers?.onMessage({
        source,
        senderId: actorId,
        ...projection,
        event: { id, type: "file", actorId, sentAt },
        sentAt,
      });
      return;
    }
    const notices: Readonly<Record<string, string>> = {
      group_recall: "recall",
      friend_recall: "recall",
      group_increase: "member_joined",
      group_decrease: "member_left",
    };
    const type =
      payload.notice_type === "notify" && payload.sub_type === "poke" ? "poke" : notices[String(payload.notice_type)];
    if (!type) return;
    const event = {
      id: createHash("sha256")
        .update(
          JSON.stringify([
            source.authority,
            source.chatType,
            source.chatId,
            type,
            payload.time,
            actorId,
            payload.operator_id,
            payload.target_id,
            payload.message_id,
            payload.sub_type,
          ]),
        )
        .digest("hex"),
      type,
      actorId: payload.operator_id === undefined ? actorId : oneBot11Id(payload.operator_id),
      sentAt,
      ...(payload.target_id === undefined ? {} : { targetId: oneBot11Id(payload.target_id) }),
      ...(payload.message_id === undefined ? {} : { messageId: oneBot11Id(payload.message_id) }),
    };
    await this.handlers?.onEvent?.(source, event);
    if (type === "member_joined" || type === "member_left") {
      if (payload.notice_type === "group_decrease") this.members.get(this.memberKey(source))?.delete(actorId);
      await this.handlers?.onParticipantsChanged?.();
    }
  }

  private async refreshMembers(source: AgentChannelSource) {
    const rows = await this.transport.action("get_group_member_list", { group_id: oneBot11WireId(source.chatId) });
    if (!Array.isArray(rows)) throw new Error("OneBot group member list must be an array.");
    const roster = new Map<string, string>();
    for (const row of rows) {
      const member = oneBot11Record(row);
      const id = oneBot11Id(member.user_id);
      roster.set(id, name(member.card) ?? name(member.nickname) ?? id);
    }
    this.members.set(this.memberKey(source), roster);
  }
  private memberKey(source: AgentChannelSource): string {
    return `${source.chatType}:${source.chatId}`;
  }
  private requireSource(source: AgentChannelSource): void {
    if (!this.canParticipate(source))
      throw Object.assign(new Error("This OneBot source is not authorized for the current account."), {
        retryable: false,
      });
  }
  private updateStatus(value: unknown): void {
    const status = oneBot11Record(value);
    this.setState(status.online === true && status.good === true ? "connected" : "degraded");
  }
  private setState(state: AgentChannelConnectionState): void {
    const changed = state !== this.state || (state === "connected" && this.error !== undefined);
    if (state === "connected") this.error = undefined;
    this.state = state;
    if (changed) this.handlers?.onConnectionStateChanged?.(state);
  }
}

function name(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function eventTime(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(new Date(value * 1_000).getTime()))
    throw new Error("OneBot events require a valid Unix timestamp.");
  return new Date(value * 1_000).toISOString();
}
function wireSegments(value: unknown): CommonTypes.Segment[] {
  if (typeof value === "string") return CQCode.parse(value);
  if (!Array.isArray(value)) throw new Error("OneBot messages must contain CQ text or an ordered segment array.");
  return cloneOneBot11Segments(
    value.map((entry: unknown) => {
      const segment = oneBot11Record(entry);
      if (typeof segment.type !== "string") throw new Error("OneBot segment type is required.");
      return { type: segment.type, data: oneBot11Record(segment.data) };
    }),
  );
}
