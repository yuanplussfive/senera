import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomInt, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import {
  Account,
  Adapter,
  AdapterRegistry,
  BaseApp,
  defineAdapterCapabilities,
  ProtocolRegistry,
  requirePositiveIntegerParam,
  requireNonEmptyStringParam,
  requireBooleanParam,
  type CommonEvent,
  type CommonTypes,
} from "onebots";
// Importing the protocol registers OneBot 11 with OneBots' protocol registry.
import { OneBotV11Protocol, onebotV11Schema } from "@onebots/protocol-onebot-v11";
import { projectOneBotV11Notice } from "@onebots/protocol-onebot-v11/lib/notice-projector.js";
import {
  AgentChannelChatTypes,
  AgentChannelKinds,
  type AgentChannelAdapter,
  type AgentChannelAdapterHandlers,
  type AgentChannelCapabilities,
  type AgentChannelClientConversation,
  type AgentChannelClientConversationSummary,
  type AgentChannelTask,
  type AgentChannelTimelinePage,
  type AgentChannelEvent,
  type AgentChannelConnectionInfo,
  type AgentChannelConnectionState,
  type AgentChannelHistoryMessage,
  type AgentChannelInboundMessage,
  type AgentChannelMedia,
  type AgentChannelOutboundSegment,
  type AgentChannelSendReplyOptions,
  type AgentChannelSendResult,
  type AgentChannelSource,
} from "../AgentChannelTypes.js";
import { AgentOneBot11GatewayDefaults } from "../AgentOneBot11Configuration.js";
import { AgentOneBot11ClientSendLedger, type OneBotClientSendIdentity } from "./AgentOneBot11ClientSendLedger.js";
import type { AgentChannelTimelineSync } from "../AgentChannelTypes.js";
import { AgentEmbeddedOneBotApp } from "./AgentEmbeddedOneBotApp.js";
import { AgentOneBot11MediaStore } from "./AgentOneBot11MediaStore.js";
import {
  AgentOneBot11MessageStore,
  agentOneBot11MessageStorePath,
  type OneBotGatewayRecord,
} from "./AgentOneBot11MessageStore.js";
import { writeFileAtomic } from "../../Core/AgentFs.js";
import { isSameAgentChannelConversation, serializeAgentChannelConversation } from "../AgentChannelSessionIdentity.js";
import type { AgentDirectory } from "../../Profile/AgentDirectory.js";
import type { AgentUploadStore } from "../../Uploads/AgentUploadStore.js";
import { AgentOneBot11Capabilities } from "./AgentOneBot11ConnectionConfig.js";
import {
  cloneOneBot11Segments,
  projectOneBot11InboundMessage,
  projectOneBot11OutboundMessage,
  stringifyOneBot11Segments,
} from "./AgentOneBot11MessageProjection.js";

const SeneraOneBotPlatform = "senera-onebot11";
const OneBotProtocolName = "onebot";
const OneBotProtocolVersion = "v11";
const OneBotLoginInfoAction = "get_login_info";

const SeneraOneBotCapabilities = defineAdapterCapabilities({
  actions: {
    send_message: { support: "native", scenes: ["private", "group"] },
    delete_message: { support: "native" },
    get_message: { support: "native" },
    get_message_history: { support: "native", scenes: ["private", "group"] },
    get_friend_list: { support: "native" },
    get_user_info: { support: "native" },
    get_group_list: { support: "native" },
    get_group_info: { support: "native" },
    get_group_member_list: { support: "native" },
    get_group_member_info: { support: "native" },
    set_group_name: { support: "native" },
    can_send_image: { support: "native" },
    can_send_record: { support: "native" },
    get_status: { support: "native" },
    get_version: { support: "native" },
    send_poke: { support: "native", scenes: ["private", "group"] },
    set_msg_emoji_like: { support: "native", scenes: ["group"] },
    get_essence_msg_list: { support: "native", scenes: ["group"] },
    set_essence_msg: { support: "native", scenes: ["group"] },
    delete_essence_msg: { support: "native", scenes: ["group"] },
  },
  events: {
    message: { support: "native", scenes: ["private", "group"] },
    message_deleted: { support: "native" },
    interaction: { support: "native", scenes: ["private", "group"] },
    custom: { support: "native", scenes: ["group"] },
  },
  segments: {
    text: { support: "native", direction: "both" },
    image: { support: "native", direction: "both" },
    record: { support: "native", direction: "both" },
    audio: { support: "native", direction: "both" },
    video: { support: "native", direction: "both" },
    file: { support: "native", direction: "both" },
    at: { support: "native", direction: "both" },
    reply: { support: "native", direction: "both" },
    face: { support: "native", direction: "both" },
    share: { support: "native", direction: "both" },
    contact: { support: "native", direction: "both" },
    location: { support: "native", direction: "both" },
    music: { support: "native", direction: "both" },
    forward: { support: "native", direction: "both" },
    node: { support: "native", direction: "both" },
    xml: { support: "native", direction: "both" },
    json: { support: "native", direction: "both" },
  },
  transports: {
    websocket: { support: "native", mode: "websocket" },
  },
});

const OneBotGatewayDefaults = Object.freeze({
  maximumHistoryEntries: 200,
});

const activeGatewayRuntimes = new Map<string, SeneraOneBotGateway>();
/**
 * `BaseApp.configDir` is static in OneBots for legacy compatibility. App
 * construction captures it synchronously, so serialize the brief mutation to
 * make concurrent workspace startup deterministic and restore it on every
 * outcome.
 */
let embeddedAppConstruction: Promise<void> = Promise.resolve();

/**
 * The published protocol implements the complete OneBot 11 action and
 * transport surface. It currently derives `get_login_info.nickname` from the
 * account identifier rather than the account metadata, so the local gateway
 * returns the local user's configured name for the logged-in client account.
 * Message annotations extend upstream message responses without replacing
 * OneBots' message conversion or action validation.
 */
class SeneraOneBotV11Protocol extends OneBotV11Protocol {
  override async apply(action: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const gateway = this.account.client;
    if (action !== OneBotLoginInfoAction) {
      const execute = () => super.apply(action, params);
      let result: Record<string, unknown>;
      try {
        result =
          gateway instanceof SeneraOneBotGateway
            ? await gateway.clientSends.run(action, params, execute)
            : await execute();
      } catch (error) {
        // Return an ordinary action response so the upstream transport preserves echo.
        return { status: "failed", retcode: -1, msg: error instanceof Error ? error.message : String(error) };
      }
      if (gateway instanceof SeneraOneBotGateway && result.status === "ok") {
        if (action === "get_msg" && result.data && typeof result.data === "object") {
          gateway.annotateMessage(result.data as Record<string, unknown>);
        }
        if (action === "get_group_msg_history" && result.data && typeof result.data === "object") {
          const messages = (result.data as Record<string, unknown>).messages;
          if (Array.isArray(messages)) for (const message of messages) gateway.annotateMessage(message);
        }
      }
      return result;
    }
    return {
      status: "ok",
      retcode: 0,
      data: {
        user_id: this.adapter.resolveAccountId(this.account.account_id).number,
        nickname: gateway instanceof SeneraOneBotGateway ? gateway.operatorDisplayName : this.account.nickname,
      },
    };
  }
}

/**
 * OneBots owns the OneBot 11 wire protocol, HTTP actions, WebSocket actions,
 * echo handling, CQ conversion and heartbeats. This adapter contributes only
 * the Senera projection for a local virtual account.
 */
class SeneraOneBotGatewayAdapter extends Adapter {
  readonly icon = "message-circle";

  constructor(app: BaseApp) {
    super(app, SeneraOneBotPlatform, SeneraOneBotCapabilities);
  }

  /**
   * OneBot 11 defines bot, user, group and message identifiers as numbers.
   * The framework's default adapter map preserves arbitrary platform IDs by
   * allocating a local number for strings, which is correct for platforms
   * such as Discord but would make a virtual OneBot account expose a random
   * `self_id`. Keep valid OneBot numeric strings in their protocol-native
   * domain and retain the framework map only for framework-private IDs.
   */
  override resolveAccountId(accountId: string): CommonTypes.Id {
    return this.resolveId(accountId);
  }

  override resolveId(id: string | number | CommonTypes.Id): CommonTypes.Id {
    if (typeof id === "object" && id !== null) return id;
    const numeric = typeof id === "number" ? id : numericOneBotIdentifier(id);
    if (numeric !== undefined) {
      return { string: String(numeric), number: numeric, source: numeric };
    }
    return super.resolveId(id);
  }

  createAccount(config: Account.Config): Account {
    const runtimeKey = stringValue((config as Record<string, unknown>).runtime_key);
    const gateway = runtimeKey ? activeGatewayRuntimes.get(runtimeKey) : undefined;
    if (!gateway) throw new Error("The local OneBot gateway runtime is unavailable.");
    const account = new Account(this, gateway, config);
    account.nickname = gateway.operatorDisplayName;
    account.on("start", () => gateway.attachAccount(account));
    return account;
  }

  async sendMessage(accountId: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
    const gateway = this.gateway(accountId);
    const source = gateway.sourceForClientMessage(params.scene_type, params.scene_id.string);
    const record = await gateway.receiveClientMessage(source, params.message);
    return {
      message_id: this.resolveId(record.id),
      scene: { scene_type: params.scene_type, scene_id: params.scene_id },
    };
  }

  override isPlatformActionImplemented(action: string): boolean {
    return [
      "send_poke",
      "set_msg_emoji_like",
      "get_essence_msg_list",
      "set_essence_msg",
      "delete_essence_msg",
    ].includes(action);
  }

  override async executePlatformAction(
    accountId: string,
    action: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const gateway = this.gateway(accountId);
    if (action === "get_essence_msg_list") {
      return gateway.essence(String(requirePositiveIntegerParam(params, "group_id")));
    }
    if (action === "set_msg_emoji_like") {
      return gateway.react(
        String(requirePositiveIntegerParam(params, "message_id")),
        requireNonEmptyStringParam(params, "emoji_id"),
        params.is_set === undefined ? true : requireBooleanParam(params, "is_set"),
        params.group_id === undefined ? undefined : String(requirePositiveIntegerParam(params, "group_id")),
      );
    }
    if (action === "set_essence_msg" || action === "delete_essence_msg") {
      return gateway.setEssence(
        String(requirePositiveIntegerParam(params, "message_id")),
        action === "set_essence_msg",
        params.group_id === undefined ? undefined : String(requirePositiveIntegerParam(params, "group_id")),
      );
    }
    if (action !== "send_poke") throw new Error(`Unsupported OneBot platform action: ${action}.`);
    const userId = typeof params.user_id === "number" ? params.user_id : Number(params.user_id);
    assertIdentity(userId, "poke target");
    const groupId = params.group_id === undefined ? undefined : Number(params.group_id);
    if (groupId !== undefined) assertIdentity(groupId, "poke group");
    const source = gateway.sourceForClientMessage(
      groupId === undefined ? "private" : "group",
      String(groupId ?? userId),
    );
    await gateway.poke(source, gateway.operatorId, userId);
    return {};
  }

  async deleteMessage(accountId: string, params: Adapter.DeleteMessageParams): Promise<void> {
    await this.gateway(accountId).deleteClientMessage(String(params.message_id.string));
  }

  async getMessage(accountId: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
    const record = this.gateway(accountId).get(String(params.message_id.string));
    if (!record) throw new Error("The requested virtual OneBot message no longer exists.");
    return this.messageInfo(record);
  }

  async getMessageHistory(accountId: string, params: Adapter.GetMessageHistoryParams): Promise<Adapter.MessageInfo[]> {
    const records = this.gateway(accountId).historyForScene(
      params.scene_type,
      params.scene_id.string,
      params.limit,
      params.start_message_id?.number === 0 ? undefined : params.start_message_id?.string,
      params.offset,
    );
    // OneBot history is chronological; the store pages backwards from the
    // cursor so it can select the most recent page without losing older data.
    return [...records].reverse().map((record) => this.messageInfo(record));
  }

  async getFriendList(accountId: string): Promise<Adapter.FriendInfo[]> {
    const gateway = this.gateway(accountId);
    return gateway.directory
      .snapshot()
      .agents.filter((agent) => agent.enabled)
      .map((agent) => ({
        user_id: this.resolveId(agent.qqUserId!),
        user_name: agent.name,
      }));
  }

  async getUserInfo(accountId: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
    const gateway = this.gateway(accountId);
    const id = params.user_id.string;
    return {
      user_id: this.resolveId(id),
      user_name: gateway.participantName(id),
    };
  }

  async canSendImage(_accountId: string): Promise<boolean> {
    return true;
  }

  async canSendRecord(_accountId: string): Promise<boolean> {
    return true;
  }

  async getGroupList(accountId: string): Promise<Adapter.GroupInfo[]> {
    return this.gateway(accountId)
      .groups()
      .map((group) => ({
        group_id: this.resolveId(group.id),
        group_name: group.name,
        member_count: group.memberAgentIds.length + 1,
      }));
  }

  async getGroupInfo(accountId: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
    const group = this.gateway(accountId).group(params.group_id.string);
    return {
      group_id: this.resolveId(group.id),
      group_name: group.name,
      member_count: group.memberAgentIds.length + 1,
      created_time: Math.floor(Date.parse(group.createdAt) / 1000),
    };
  }

  async getGroupMemberList(
    accountId: string,
    params: Adapter.GetGroupMemberListParams,
  ): Promise<Adapter.GroupMemberInfo[]> {
    const gateway = this.gateway(accountId);
    const group = gateway.group(params.group_id.string);
    return [gateway.operatorId, ...group.memberAgentIds.map((id) => gateway.directory.get(id).qqUserId!)].map((id) => ({
      group_id: params.group_id,
      user_id: this.resolveId(id),
      user_name: gateway.participantName(String(id)),
      role: id === gateway.operatorId ? "owner" : "member",
      card: "",
      join_time: Math.floor(Date.parse(group.createdAt) / 1000),
    }));
  }

  async getGroupMemberInfo(
    accountId: string,
    params: Adapter.GetGroupMemberInfoParams,
  ): Promise<Adapter.GroupMemberInfo> {
    const member = (await this.getGroupMemberList(accountId, params)).find(
      (entry) => entry.user_id.string === params.user_id.string,
    );
    if (!member) throw new Error("The requested account is not a group member.");
    return member;
  }

  async setGroupName(accountId: string, params: Adapter.SetGroupNameParams): Promise<void> {
    const gateway = this.gateway(accountId);
    const group = gateway.group(params.group_id.string);
    gateway.directory.execute({
      type: "group.update",
      revision: gateway.directory.snapshot().revision,
      id: group.id,
      group: { name: params.group_name, memberAgentIds: group.memberAgentIds },
    });
  }

  async getStatus(_accountId: string): Promise<Adapter.StatusInfo> {
    return { online: true, good: true };
  }

  async getVersion(_accountId: string): Promise<Adapter.VersionInfo> {
    return { app_name: "Senera Virtual OneBot Gateway", app_version: "1", onebot_version: "11" };
  }

  private gateway(accountId: string): SeneraOneBotGateway {
    const account = this.getAccount(accountId);
    const gateway = account?.client;
    if (!(gateway instanceof SeneraOneBotGateway)) {
      throw new Error("The local OneBot account is not bound to a gateway runtime.");
    }
    return gateway;
  }

  private messageInfo(record: OneBotGatewayRecord): Adapter.MessageInfo {
    const sceneType = record.source.chatType === AgentChannelChatTypes.Group ? "group" : "private";
    return {
      message_id: this.resolveId(record.id),
      time: Math.floor(Date.parse(record.sentAt) / 1_000),
      sender: {
        scene_type: sceneType,
        sender_id: this.resolveId(record.senderId ?? record.source.userId),
        scene_id: this.resolveId(record.source.chatId),
        sender_name: record.displayName ?? "",
        scene_name: record.source.displayName ?? record.source.chatId,
      },
      message: cloneOneBot11Segments(record.segments),
    };
  }
}

/** Runtime bridge between the OneBots virtual account and Senera's channel adapter. */
class SeneraOneBotGateway {
  readonly key: string;
  readonly selfId: number;
  readonly operatorId: number;
  private account?: Account;
  private store?: AgentOneBot11MessageStore;
  readonly clientSends = new AgentOneBot11ClientSendLedger(() => this.messages());

  constructor(
    private readonly options: {
      readonly runtimeKey: string;
      readonly directory: AgentDirectory;
      readonly mediaStore: AgentOneBot11MediaStore;
      readonly selfId: number;
      readonly operatorId: number;
      readonly resolveOperatorDisplayName: () => string;
      readonly onInbound: (message: AgentChannelInboundMessage) => Promise<void>;
      readonly onEvent: (
        source: AgentChannelSource,
        event: AgentChannelEvent,
        task?: AgentChannelTask,
      ) => Promise<void>;
      readonly onInboundFailure: (error: unknown) => void;
      readonly onRecall: (source: AgentChannelSource, messageId: string) => Promise<void>;
    },
  ) {
    this.key = options.runtimeKey;
    this.selfId = options.selfId;
    this.operatorId = options.operatorId;
  }

  get displayName(): string {
    return this.directory.get().name;
  }

  get directory(): AgentDirectory {
    return this.options.directory;
  }

  participantName(id: string): string {
    if (id === String(this.operatorId)) return this.operatorDisplayName;
    const agent = this.directory.snapshot().agents.find((entry) => String(entry.qqUserId) === id);
    if (!agent) throw new Error("The requested account is not a participant in this workspace.");
    return agent.name;
  }

  group(id: string) {
    const group = this.directory.snapshot().groups.find((entry) => String(entry.id) === id);
    if (!group) throw new Error("The requested local group does not exist.");
    return group;
  }

  senderAgent(source: AgentChannelSource) {
    if (source.chatType === AgentChannelChatTypes.Group) {
      if (!source.agentId || !this.group(source.chatId).memberAgentIds.includes(source.agentId))
        throw new Error("The sender Agent is not a member of this group.");
      return this.directory.resolve(source.agentId);
    }
    const agent = this.directory.snapshot().agents.find((entry) => String(entry.qqUserId) === source.chatId);
    if (!agent) throw new Error("The direct-message recipient does not exist.");
    return this.directory.resolve(agent.id);
  }

  get operatorDisplayName(): string {
    return this.options.resolveOperatorDisplayName();
  }

  attachAccount(account: Account): void {
    this.account = account;
  }

  attachStore(store: AgentOneBot11MessageStore): void {
    this.store = store;
  }

  private messages(): AgentOneBot11MessageStore {
    if (!this.store) throw new Error("The local OneBot message store is not ready.");
    return this.store;
  }

  sourceForClientMessage(scene: CommonTypes.Scene, sceneId: string): AgentChannelSource {
    if (scene === "group") {
      this.group(sceneId);
      return {
        platform: AgentChannelKinds.OneBot11,
        chatType: AgentChannelChatTypes.Group,
        chatId: sceneId,
        userId: String(this.operatorId),
        displayName: this.operatorDisplayName,
      };
    }
    const agent = this.directory.snapshot().agents.find((entry) => String(entry.qqUserId) === sceneId);
    if (!agent) throw new Error("The local OneBot contact does not exist.");
    return {
      platform: AgentChannelKinds.OneBot11,
      chatType: AgentChannelChatTypes.Direct,
      agentId: agent.id,
      chatId: sceneId,
      userId: String(this.operatorId),
      displayName: this.operatorDisplayName,
    };
  }

  async receiveClientMessage(
    source: AgentChannelSource,
    message: readonly CommonTypes.Segment[],
  ): Promise<OneBotGatewayRecord> {
    const revision = this.messages().revision(source);
    const segments = cloneOneBot11Segments(message);
    const imported = await this.options.mediaStore.importSegments(this.options.mediaStore.clientSegments(segments));
    const inbound = projectOneBot11InboundMessage(imported);
    const attachments = await this.options.mediaStore.resolveAttachments(inbound.attachments ?? []);
    this.assertHistoryRevision(source, revision);
    const record = this.record(
      {
        source,
        direction: "inbound",
        text: inbound.text,
        segments: imported,
        senderId: String(this.operatorId),
        displayName: this.operatorDisplayName,
      },
      undefined,
      this.clientSends.current,
    );
    // The QQ client already renders its own successful send. Echoing that action as
    // a received message duplicates it and reverses the conversation sides.
    // A OneBot action response acknowledges only that the virtual client
    // accepted the message. Waiting for the full Senera turn here would hold
    // a standard send_message call open until model execution settles.
    void this.options
      .onInbound({
        source: { ...source, messageId: record.id },
        senderId: record.senderId,
        text: inbound.text,
        segments: inbound.segments,
        ...(attachments.length ? { attachments } : {}),
        ...(inbound.replyToMessageId ? { replyToMessageId: inbound.replyToMessageId } : {}),
        ...(inbound.replyToMessageId ? { replyToSenderId: this.get(inbound.replyToMessageId)?.senderId } : {}),
        sentAt: record.sentAt,
        raw: { protocol: "onebot11", segments },
      })
      .catch((error: unknown) => this.options.onInboundFailure(error));
    return record;
  }

  async publish(
    source: AgentChannelSource,
    text: string,
    replyToMessageId?: string,
    media?: readonly AgentChannelMedia[],
    parts?: readonly AgentChannelOutboundSegment[],
    task?: AgentChannelTask,
    mentionIds?: readonly string[],
  ): Promise<OneBotGatewayRecord> {
    const revision = this.messages().revision(source);
    if (replyToMessageId) {
      const target = this.messages().get(replyToMessageId);
      if (!target || this.messages().isRecalled(target.id) || !isSameAgentChannelConversation(target.source, source)) {
        throw new Error("The reply target does not exist in the current OneBot conversation.");
      }
    }
    const deliveredParts = parts
      ? await Promise.all(
          parts.map(async (part): Promise<AgentChannelOutboundSegment> => {
            if (part.kind === "text") return part;
            return { kind: "media", media: await this.options.mediaStore.exportItem(part.media) };
          }),
        )
      : undefined;
    const deliveredMedia = deliveredParts ? undefined : await this.options.mediaStore.exportMedia(media ?? []);
    this.assertHistoryRevision(source, revision);
    const segments = projectOneBot11OutboundMessage({
      text,
      replyToMessageId,
      media: deliveredMedia,
      parts: deliveredParts,
      mentionIds,
    });
    const record = this.record(
      {
        source,
        direction: "outbound",
        text,
        segments,
        senderId: String(this.senderAgent(source).qqUserId),
        displayName: this.senderAgent(source).name,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
      task,
    );
    await this.dispatch(record);
    void this.observePublishedMessage(record, task).catch((error: unknown) => this.options.onInboundFailure(error));
    return record;
  }

  private async observePublishedMessage(record: OneBotGatewayRecord, task?: AgentChannelTask): Promise<void> {
    const source = record.source;
    const projected = projectOneBot11InboundMessage(record.segments);
    await this.options.onInbound({
      source: { ...source, agentId: undefined, messageId: record.id, displayName: record.displayName },
      senderId: record.senderId,
      ...(task ? { task } : {}),
      text: record.text,
      segments: projected.segments,
      ...(projected.attachments?.length
        ? { attachments: await this.options.mediaStore.resolveAttachments(projected.attachments) }
        : {}),
      ...(record.replyToMessageId
        ? { replyToMessageId: record.replyToMessageId, replyToSenderId: this.get(record.replyToMessageId)?.senderId }
        : {}),
      sentAt: record.sentAt,
    });
  }

  async deleteClientMessage(messageId: string): Promise<void> {
    const record = this.messages().get(messageId);
    if (!record || record.direction !== "inbound" || record.senderId !== String(this.operatorId)) {
      throw new Error("Only a message sent by the local virtual client can be recalled.");
    }
    if (this.messages().isRecalled(messageId)) return;
    const original = await this.nativeMessage(record.id);
    const notice = this.deletionNotice(record);
    await this.options.onRecall(record.source, record.id);
    const payload = {
      ...this.nativeNotice(notice),
      originMsg: original,
    };
    if (this.messages().get(record.id)) this.messages().recall(record.id, record.source, notice.id.string, payload);
    else this.messages().appendNotice(record.source, notice.id.string, payload);
    await this.account!.dispatchAwaited(notice);
    this.deliverRecall(record, notice);
  }

  async poke(source: AgentChannelSource, actorId: number, targetId: number, task?: AgentChannelTask): Promise<void> {
    if (source.platform !== AgentChannelKinds.OneBot11 || source.userId !== String(this.operatorId)) {
      throw new Error("The poke source does not belong to this local OneBot account.");
    }
    const participants =
      source.chatType === AgentChannelChatTypes.Group
        ? [this.operatorId, ...this.group(source.chatId).memberAgentIds.map((id) => this.directory.get(id).qqUserId!)]
        : [this.operatorId, this.senderAgent(source).qqUserId!];
    if (!participants.includes(actorId) || !participants.includes(targetId)) {
      throw new Error("The poke participants must belong to the current local conversation.");
    }
    const account = this.account;
    if (!account) throw new Error("The OneBot account has not started.");
    const event: AgentChannelEvent = {
      id: randomUUID(),
      type: "poke",
      actorId: String(actorId),
      targetId: String(targetId),
      actorName: this.participantName(String(actorId)),
      targetName: this.participantName(String(targetId)),
      sentAt: new Date().toISOString(),
    };
    const notice: CommonEvent.Notice = {
      id: account.adapter.createId(event.id),
      timestamp: Date.parse(event.sentAt),
      type: "notice",
      platform: SeneraOneBotPlatform,
      bot_id: account.adapter.resolveAccountId(account.account_id),
      notice_type: "interaction",
      sub_type: "poke",
      user: { id: account.adapter.resolveId(actorId), name: event.actorName },
      target_id: account.adapter.resolveId(targetId),
      ...(source.chatType === AgentChannelChatTypes.Group
        ? { group: { id: account.adapter.resolveId(source.chatId) } }
        : {}),
    };
    this.messages().appendNotice(source, event.id, this.nativeNotice(notice), task);
    await account.dispatchAwaited(notice);
    // Peers observe activity; recipient routing excludes the actor itself.
    this.deliverEvent(source, event, task);
  }

  private deliverEvent(source: AgentChannelSource, event: AgentChannelEvent, task?: AgentChannelTask): void {
    void this.options.onEvent(source, event, task).catch((error: unknown) => this.options.onInboundFailure(error));
  }

  annotateMessage(message: Record<string, unknown>): void {
    Object.assign(message, this.messages().annotations(String(message.message_id)));
  }

  private annotationTarget(messageId: string, groupId?: string): OneBotGatewayRecord {
    const record = this.messages().get(messageId);
    if (!record || this.messages().isRecalled(messageId) || record.source.chatType !== AgentChannelChatTypes.Group) {
      throw new Error("Select an existing group message to change its annotations.");
    }
    const group = this.group(record.source.chatId);
    if (groupId !== undefined && String(group.id) !== groupId) {
      throw new Error("The message does not belong to the requested group.");
    }
    return record;
  }

  private async publishAnnotations(record: OneBotGatewayRecord, subtype: string): Promise<Record<string, unknown>> {
    const account = this.account;
    if (!account) throw new Error("The OneBot account has not started.");
    const snapshot = {
      message_id: Number(record.id),
      group_id: Number(record.source.chatId),
      ...this.messages().annotations(record.id),
    };
    const notice: CommonEvent.Notice = {
      id: account.adapter.createId(randomUUID()),
      timestamp: Date.now(),
      type: "notice",
      platform: SeneraOneBotPlatform,
      bot_id: account.adapter.resolveAccountId(account.account_id),
      notice_type: "custom",
      sub_type: subtype,
      user: { id: account.adapter.resolveId(this.operatorId), name: this.operatorDisplayName },
      group: { id: account.adapter.resolveId(record.source.chatId) },
      message_id: account.adapter.resolveId(record.id),
      extensions: snapshot,
    };
    await account.dispatchAwaited(notice);
    return snapshot;
  }

  async react(
    messageId: string,
    emojiId: string,
    enabled: boolean,
    groupId?: string,
  ): Promise<Record<string, unknown>> {
    const record = this.annotationTarget(messageId, groupId);
    this.messages().setReaction(messageId, String(this.operatorId), emojiId, enabled);
    this.messages().invalidateSnapshot(record.source);
    return this.publishAnnotations(record, "group_msg_emoji_like");
  }

  async setEssence(messageId: string, enabled: boolean, groupId?: string): Promise<Record<string, unknown>> {
    const record = this.annotationTarget(messageId, groupId);
    this.messages().setEssence(messageId, String(this.operatorId), enabled);
    this.messages().invalidateSnapshot(record.source);
    return this.publishAnnotations(record, "essence");
  }

  async essence(groupId: string): Promise<readonly Record<string, unknown>[]> {
    this.group(groupId);
    return Promise.all(
      this.messages()
        .essence(groupId)
        .map(async (entry) => {
          const message = await this.nativeMessage(entry.messageId);
          const sender = message.sender as Record<string, unknown>;
          return {
            message_id: Number(entry.messageId),
            sender_id: sender.user_id,
            sender_nick: sender.nickname,
            sender_time: message.time,
            operator_id: Number(entry.operatorId),
            operator_nick: this.participantName(entry.operatorId),
            operator_time: Math.floor(Date.parse(entry.createdAt) / 1_000),
            content: message.message,
          };
        }),
    );
  }

  async deleteOutboundMessage(messageId: string, source: AgentChannelSource): Promise<void> {
    const record = this.messages().get(messageId);
    if (
      !record ||
      record.direction !== "outbound" ||
      !isSameAgentChannelConversation(record.source, source) ||
      record.senderId !== String(this.senderAgent(source).qqUserId)
    ) {
      throw new Error("Only a message sent by the virtual account in the current conversation can be recalled.");
    }
    await this.deleteRecord(record);
  }

  private async deleteRecord(record: OneBotGatewayRecord): Promise<void> {
    if (this.messages().isRecalled(record.id)) return;
    const original = await this.nativeMessage(record.id);
    const notice = this.deletionNotice(record);
    this.messages().recall(record.id, record.source, notice.id.string, {
      ...this.nativeNotice(notice),
      ...(record.direction === "inbound" ? { originMsg: original } : {}),
    });
    await this.account!.dispatchAwaited(notice);
    this.deliverRecall(record, notice);
  }

  private deliverRecall(record: OneBotGatewayRecord, notice: CommonEvent.Notice): void {
    if (!record.senderId) throw new Error("A recalled OneBot message has no sender identity.");
    this.deliverEvent(record.source, {
      id: notice.id.string,
      type: "recall",
      actorId: record.senderId,
      ...(record.displayName ? { actorName: record.displayName } : {}),
      messageId: record.id,
      sentAt: new Date(notice.timestamp).toISOString(),
    });
  }

  bindHistory(source: AgentChannelSource, key: string, task: AgentChannelTask, preserveExisting = false): void {
    if (key.startsWith("message:")) this.assertMessageSource(source, key.slice("message:".length));
    this.messages().bind(source, key, task, preserveExisting);
  }

  resolveMessageTask(source: AgentChannelSource, messageId: string): AgentChannelTask | undefined {
    this.assertMessageSource(source, messageId);
    return this.messages().task(`message:${messageId}`);
  }

  resolveMessageTasks(source: AgentChannelSource, messageId: string): readonly AgentChannelTask[] {
    this.assertMessageSource(source, messageId);
    return this.messages().dispatchTasks(`message:${messageId}`);
  }

  private assertMessageSource(source: AgentChannelSource, messageId: string): void {
    const record = this.messages().get(messageId);
    if (!record || !isSameAgentChannelConversation(record.source, source)) {
      throw new Error("The message does not belong to this conversation.");
    }
  }

  private protocol(): OneBotV11Protocol {
    const protocol = this.account?.protocols.find((item) => item instanceof OneBotV11Protocol);
    if (!(protocol instanceof OneBotV11Protocol)) throw new Error("The OneBot protocol is not connected.");
    return protocol;
  }

  private async nativeMessage(messageId: string): Promise<Record<string, unknown>> {
    const result = await this.protocol().apply("get_msg", { message_id: Number(messageId) });
    if (result.status !== "ok" || !result.data || typeof result.data !== "object") {
      throw new Error("The OneBot protocol could not read the message.");
    }
    return result.data as Record<string, unknown>;
  }

  private nativeNotice(notice: CommonEvent.Notice): Record<string, unknown> {
    return this.protocol().format("notice", {
      ...projectOneBotV11Notice(notice),
      time: Math.floor(notice.timestamp / 1_000),
    });
  }

  async timeline(
    source: AgentChannelSource,
    before?: number,
    limit: number = OneBotGatewayDefaults.maximumHistoryEntries,
    sync?: AgentChannelTimelineSync,
  ): Promise<AgentChannelTimelinePage> {
    const cursor = this.messages().cursor(source);
    const reset = Boolean(sync && (sync.after.revision !== cursor.revision || sync.after.sequence > cursor.sequence));
    const incremental = sync !== undefined && !reset;
    const rows = incremental
      ? this.messages().timelineAfter(source, sync.after.sequence, cursor.sequence, limit + 1)
      : this.messages().timeline(source, limit + 1, before);
    const page = rows.slice(0, limit);
    const entries = await Promise.all(
      (incremental ? page : [...page].reverse()).map(async (row) => ({
        sequence: row.sequence,
        key: row.key,
        ...(row.task ? { task: row.task } : {}),
        payload: row.notice ?? { ...(await this.nativeMessage(row.messageId!)), post_type: "message" },
      })),
    );
    return {
      entries,
      before: rows.length > limit ? page.at(-1)!.sequence : null,
      sync: {
        cursor: { ...cursor, sequence: incremental && rows.length > limit ? page.at(-1)!.sequence : cursor.sequence },
        hasMore: incremental && rows.length > limit,
        reset,
      },
    };
  }

  async conversations(): Promise<readonly AgentChannelClientConversationSummary[]> {
    const snapshot = this.directory.snapshot();
    const targets = [
      ...snapshot.agents
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          chatType: "direct" as const,
          chatId: String(agent.qqUserId),
          name: agent.name,
        })),
      ...this.groups().map((group) => ({ chatType: "group" as const, chatId: String(group.id), name: group.name })),
    ];
    const latest = this.messages().latestConversations();
    const entries = await Promise.all(
      targets.map(async (target) => {
        const source = this.sourceForClientMessage(target.chatType === "group" ? "group" : "private", target.chatId);
        const row = latest.get(serializeAgentChannelConversation(source));
        if (!row) return undefined;
        return {
          ...target,
          latest: {
            sequence: row.sequence,
            key: row.key,
            payload: row.notice ?? { ...(await this.nativeMessage(row.messageId!)), post_type: "message" },
          },
        };
      }),
    );
    return entries
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      .sort((left, right) => right.latest.sequence - left.latest.sequence);
  }

  get(messageId: string): OneBotGatewayRecord | undefined {
    const record = this.messages().get(messageId);
    return record ? this.clientRecord(record) : undefined;
  }

  isHistoryEntryCurrent(source: AgentChannelSource, key: string): boolean {
    return this.messages().isEntryCurrent(source, key);
  }

  history(source: AgentChannelSource, limit?: number, before?: string): readonly OneBotGatewayRecord[] {
    return this.messages()
      .history(source, normalizeHistoryLimit(limit), before)
      .map((record) => this.clientRecord(record));
  }

  historyForScene(
    scene: CommonTypes.Scene,
    sceneId: string,
    limit?: number,
    before?: string,
    offset?: number,
  ): readonly OneBotGatewayRecord[] {
    return this.messages()
      .historyForScene(scene, sceneId, normalizeHistoryLimit(limit), before, offset)
      .map((record) => this.clientRecord(record));
  }

  groups() {
    return this.directory.snapshot().groups;
  }

  private assertHistoryRevision(source: AgentChannelSource, revision: number): void {
    if (this.messages().revision(source) !== revision) {
      throw new Error("This OneBot operation belongs to a conversation that has been cleared.");
    }
  }

  private record(
    input: Omit<OneBotGatewayRecord, "id" | "sentAt">,
    task?: AgentChannelTask,
    clientSend?: OneBotClientSendIdentity,
  ): OneBotGatewayRecord {
    return this.clientRecord(
      this.messages().append(
        { ...input, segments: this.options.mediaStore.storeSegments(input.segments) },
        task,
        clientSend,
      ),
    );
  }

  private clientRecord(record: OneBotGatewayRecord): OneBotGatewayRecord {
    return { ...record, segments: this.options.mediaStore.clientSegments(record.segments) };
  }

  private async dispatch(record: OneBotGatewayRecord): Promise<void> {
    const account = this.account;
    if (!account) throw new Error("The OneBot account has not started.");
    const isGroup = record.source.chatType === AgentChannelChatTypes.Group;
    const senderId =
      record.senderId ?? (record.direction === "outbound" ? String(this.selfId) : String(this.operatorId));
    const event: CommonEvent.Message = {
      id: account.adapter.createId(`event:${record.id}`),
      timestamp: Date.parse(record.sentAt),
      type: "message",
      platform: SeneraOneBotPlatform,
      bot_id: account.adapter.resolveAccountId(account.account_id),
      message_type: isGroup ? "group" : "private",
      scene_id: account.adapter.resolveId(record.source.chatId),
      sender: { id: account.adapter.resolveId(senderId), name: record.displayName },
      ...(isGroup
        ? {
            group: { id: account.adapter.resolveId(record.source.chatId), name: this.group(record.source.chatId).name },
          }
        : {}),
      message: cloneOneBot11Segments(record.segments),
      raw_message: stringifyOneBot11Segments(record.segments),
      message_id: account.adapter.resolveId(record.id),
    };
    await account.dispatchAwaited(event);
  }

  async hostNotice(source: AgentChannelSource, text: string): Promise<string> {
    const account = this.account;
    if (!account) throw new Error("The OneBot account has not started.");
    const notice: CommonEvent.Notice = {
      id: account.adapter.createId(randomUUID()),
      timestamp: Date.now(),
      type: "notice",
      platform: SeneraOneBotPlatform,
      bot_id: account.adapter.resolveAccountId(account.account_id),
      notice_type: "custom",
      sub_type: "senera",
      user: { id: account.adapter.resolveId(source.chatType === "group" ? this.operatorId : source.chatId) },
      ...(source.chatType === "group" ? { group: { id: account.adapter.resolveId(source.chatId) } } : {}),
      extensions: { text },
    };
    this.messages().appendNotice(source, notice.id.string, this.nativeNotice(notice));
    await account.dispatchAwaited(notice);
    return notice.id.string;
  }

  async directoryChanged(
    previous: import("../../Core/AgentDirectoryContract.js").AgentDirectorySnapshot,
    current: import("../../Core/AgentDirectoryContract.js").AgentDirectorySnapshot,
  ): Promise<void> {
    const account = this.account;
    if (!account) return;
    const notices: CommonEvent.Notice[] = [];
    for (const group of current.groups) {
      const old = previous.groups.find((entry) => entry.id === group.id);
      for (const id of new Set([...(old?.memberAgentIds ?? []), ...group.memberAgentIds])) {
        const joined = group.memberAgentIds.includes(id);
        if (joined === (old?.memberAgentIds.includes(id) ?? false)) continue;
        const agent = (joined ? current : previous).agents.find((entry) => entry.id === id);
        if (!agent) throw new Error("A membership change has no corresponding Agent identity.");
        const notice: CommonEvent.Notice = {
          id: account.adapter.createId(randomUUID()),
          timestamp: Date.now(),
          type: "notice",
          platform: SeneraOneBotPlatform,
          bot_id: account.adapter.resolveAccountId(account.account_id),
          notice_type: joined ? "member_joined" : "member_left",
          sub_type: joined ? "invite" : "kick",
          user: { id: account.adapter.resolveId(agent.qqUserId!), name: agent.name },
          operator: { id: account.adapter.resolveId(this.operatorId), name: this.operatorDisplayName },
          group: { id: account.adapter.resolveId(group.id), name: group.name },
          extensions: { memberName: agent.name, operatorName: this.operatorDisplayName },
        };
        this.messages().appendNotice(
          this.sourceForClientMessage("group", String(group.id)),
          notice.id.string,
          this.nativeNotice(notice),
        );
        notices.push(notice);
      }
    }
    for (const notice of notices) {
      await account.dispatchAwaited(notice);
      if (!notice.group || !notice.user) throw new Error("A membership notice requires its group and participant.");
      this.deliverEvent(this.sourceForClientMessage("group", notice.group.id.string), {
        id: notice.id.string,
        type: notice.notice_type,
        actorId: String(this.operatorId),
        actorName: this.operatorDisplayName,
        targetId: notice.user.id.string,
        targetName: notice.user.name,
        sentAt: new Date(notice.timestamp).toISOString(),
      });
    }
  }

  private deletionNotice(record: OneBotGatewayRecord): CommonEvent.Notice {
    const account = this.account;
    if (!account) throw new Error("The OneBot account has not started.");
    const senderId =
      record.senderId ?? (record.direction === "outbound" ? String(this.selfId) : String(this.operatorId));
    const event: CommonEvent.Notice = {
      id: account.adapter.createId(`event:delete:${record.id}`),
      timestamp: Date.now(),
      type: "notice",
      platform: SeneraOneBotPlatform,
      bot_id: account.adapter.resolveAccountId(account.account_id),
      notice_type: "message_deleted",
      message_id: account.adapter.resolveId(record.id),
      user: { id: account.adapter.resolveId(senderId), name: record.displayName },
      ...(record.source.chatType === AgentChannelChatTypes.Group
        ? {
            group: { id: account.adapter.resolveId(record.source.chatId), name: this.group(record.source.chatId).name },
            operator: {
              id: account.adapter.resolveId(senderId),
            },
          }
        : {}),
    };
    return event;
  }
}

export interface AgentOneBot11ChannelAdapterOptions {
  readonly directory: AgentDirectory;
  /** Resolves the current workspace user identity for local client presentation. */
  readonly resolveOperatorDisplayName: () => string;
  readonly runtimeDirectory: string;
  readonly messageStore?: AgentOneBot11MessageStore;
  readonly mediaBasePath: string;
  readonly uploadStore?: Pick<AgentUploadStore, "resolve">;
}

/** Virtual OneBot 11 adapter hosted by Senera's authenticated workspace transport. */
export class AgentOneBot11ChannelAdapter implements AgentChannelAdapter {
  readonly kind = AgentChannelKinds.OneBot11;
  recordsOutboundHistory(): boolean {
    return true;
  }
  readonly capabilities: AgentChannelCapabilities = {
    ...AgentOneBot11Capabilities,
    supportsPoke: true,
  };

  private handlers?: AgentChannelAdapterHandlers;
  private connectionState: AgentChannelConnectionState = "stopped";
  private app?: AgentEmbeddedOneBotApp;
  private gateway?: SeneraOneBotGateway;
  private connectTask?: Promise<void>;
  private disconnectTask?: Promise<void>;
  private connectionAbort?: AbortController;
  private abortSignal?: AbortSignal;
  private abortHandler?: () => void;
  private unsubscribeDirectory?: () => void;
  private directoryChanges = Promise.resolve();

  constructor(private readonly options: AgentOneBot11ChannelAdapterOptions) {}

  resolveActor(senderId: string) {
    const directory = this.options.directory.snapshot();
    const owner = String(directory.operatorId) === senderId;
    const agent = directory.agents.find((entry) => String(entry.qqUserId) === senderId);
    if (!owner && !agent) return undefined;
    return {
      authority: "senera-qq",
      account: owner ? "operator" : agent!.id,
      kind: owner ? ("user" as const) : ("agent" as const),
      owner,
    };
  }

  bind(handlers: AgentChannelAdapterHandlers): void {
    this.handlers = handlers;
  }

  getConnectionState(): AgentChannelConnectionState {
    return this.connectionState;
  }

  getConnectionInfo(): AgentChannelConnectionInfo | undefined {
    const clientId = this.gateway?.operatorId;
    if (!clientId) return undefined;
    return {
      accountId: String(clientId),
    };
  }

  connectClient(socket: WebSocket, request: IncomingMessage): void {
    if (!this.app || this.connectionState !== "connected") throw new Error("OneBot channel is not connected.");
    this.app.connectClient(socket, request);
  }

  resolveClientSource(conversation: AgentChannelClientConversation): AgentChannelSource {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    return gateway.sourceForClientMessage(conversation.chatType === "group" ? "group" : "private", conversation.chatId);
  }

  routeInbound(message: AgentChannelInboundMessage): readonly AgentChannelSource[] {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    if (message.source.chatType !== AgentChannelChatTypes.Group) {
      if (!this.canParticipate(message.source)) return [];
      const agent = gateway.senderAgent(message.source);
      return [{ ...message.source, agentId: agent.id }];
    }
    return gateway
      .group(message.source.chatId)
      .memberAgentIds.map((id) => gateway.directory.get(id))
      .filter((agent) => agent.enabled)
      .filter((agent) => String(agent.qqUserId) !== (message.senderId ?? message.event?.actorId))
      .map((agent) => ({ ...message.source, agentId: agent.id }));
  }

  observeInbound(message: AgentChannelInboundMessage): readonly AgentChannelSource[] {
    return this.routeInbound(message);
  }

  canParticipate(source: AgentChannelSource): boolean {
    const snapshot = this.options.directory.snapshot();
    const agent = snapshot.agents.find((entry) =>
      source.agentId ? entry.id === source.agentId : String(entry.qqUserId) === source.chatId,
    );
    if (!agent?.enabled) return false;
    return (
      source.chatType !== AgentChannelChatTypes.Group ||
      snapshot.groups.some((group) => String(group.id) === source.chatId && group.memberAgentIds.includes(agent.id))
    );
  }

  isHistoryEntryCurrent(source: AgentChannelSource, key: string): boolean {
    return this.gateway?.isHistoryEntryCurrent(source, key) === true;
  }

  routeCommand(message: AgentChannelInboundMessage): readonly AgentChannelSource[] {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    if (message.senderId !== String(gateway.operatorId)) return [];
    const recipients = this.routeInbound(message);
    if (message.source.chatType !== "group") return recipients;
    const addressed = new Set(
      (message.segments ?? []).filter((part) => part.type === "at").map((part) => String(part.data.qq)),
    );
    if (message.replyToSenderId) addressed.add(message.replyToSenderId);
    if (!addressed.size || addressed.has("all")) return recipients;
    return recipients.filter((recipient) => addressed.has(String(gateway.directory.get(recipient.agentId).qqUserId)));
  }

  conversationContext(source: AgentChannelSource) {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    const group = source.chatType === AgentChannelChatTypes.Group ? gateway.group(source.chatId) : undefined;
    const agent = gateway.senderAgent(source);
    return {
      id: source.chatId,
      name: group?.name ?? agent.name,
      selfId: String(agent.qqUserId),
      participants: [
        { id: String(gateway.operatorId), name: gateway.operatorDisplayName, kind: "user" as const, enabled: true },
        ...(group ? group.memberAgentIds.map((id) => gateway.directory.get(id)) : [agent]).map((member) => ({
          id: String(member.qqUserId),
          name: member.name,
          kind: "agent" as const,
          enabled: member.enabled,
        })),
      ],
    };
  }

  async connect(signal: AbortSignal): Promise<void> {
    if (this.disconnectTask) await this.disconnectTask;
    if (signal.aborted) return;
    if (this.connectTask) return this.connectTask;
    if (this.app) return;
    this.connectionAbort = new AbortController();
    const connectionSignal = AbortSignal.any([signal, this.connectionAbort.signal]);
    const task = this.connectNow(connectionSignal);
    this.connectTask = task;
    try {
      await task;
    } catch (error) {
      this.setConnectionState(connectionSignal.aborted ? "stopped" : "degraded");
      if (!connectionSignal.aborted) throw error;
    } finally {
      this.connectTask = undefined;
    }
  }

  private async connectNow(signal: AbortSignal): Promise<void> {
    this.setConnectionState("connecting");
    await mkdir(this.options.runtimeDirectory, { recursive: true });
    if (signal.aborted) {
      this.setConnectionState("stopped");
      return;
    }
    ensureGatewayAdapterRegistered();
    ensureGatewayProtocolRegistered();
    const identity = await loadOneBotGatewayIdentity(this.options.runtimeDirectory);
    this.options.directory.bindOneBotIdentity(identity.selfId, identity.operatorId);
    if (signal.aborted) {
      this.setConnectionState("stopped");
      return;
    }
    const gateway = new SeneraOneBotGateway({
      directory: this.options.directory,
      runtimeKey: createGatewayRuntimeKey(this.options.runtimeDirectory, identity.selfId),
      mediaStore: new AgentOneBot11MediaStore(
        this.options.runtimeDirectory,
        this.options.mediaBasePath,
        this.options.uploadStore,
      ),
      selfId: identity.selfId,
      operatorId: identity.operatorId,
      resolveOperatorDisplayName: () => this.resolveOperatorDisplayName(),
      onInbound: async (message) => this.handlers?.onMessage(message),
      onEvent: async (source, event, task) => this.handlers?.onEvent?.(source, event, task),
      onInboundFailure: (error) => this.handlers?.onFatal(error, AgentChannelKinds.OneBot11),
      onRecall: async (source, messageId) => {
        if (!this.handlers?.onRecall) throw new Error("Authoritative conversation management is unavailable.");
        await this.handlers.onRecall(source, messageId);
      },
    });
    const accountId = String(identity.operatorId);
    let app: AgentEmbeddedOneBotApp | undefined;
    try {
      claimGatewayRuntime(gateway);
      await mkdir(path.join(this.options.runtimeDirectory, "media"), { recursive: true });
      app = await createEmbeddedApp(this.options.runtimeDirectory, {
        database: "onebot11.sqlite",
        timeout: 30,
        log_level: "warn",
      });
      this.app = app;
      this.gateway = gateway;
      await app.initializeAccount({
        platform: SeneraOneBotPlatform,
        account_id: accountId,
        runtime_key: gateway.key,
        [`${OneBotProtocolName}.${OneBotProtocolVersion}`]: {
          use_http: false,
          use_ws: true,
          heartbeat_interval: AgentOneBot11GatewayDefaults.heartbeatIntervalMs,
        },
      });
      const messageStore =
        this.options.messageStore ??
        new AgentOneBot11MessageStore(agentOneBot11MessageStorePath(this.options.runtimeDirectory));
      gateway.attachStore(messageStore);
      this.options.directory.importLegacyGroups(messageStore.groups());
      if (!this.options.messageStore) app.lifecycle.register("seneraMessages", () => messageStore.close());
      if (signal.aborted) {
        await this.stopResources();
        return;
      }
      await app.start();
      if (signal.aborted) {
        await this.stopResources();
        return;
      }
      this.bindAbortSignal(signal);
      let previous = this.options.directory.snapshot();
      this.unsubscribeDirectory = this.options.directory.subscribe(() => {
        const before = previous;
        previous = this.options.directory.snapshot();
        const current = previous;
        this.directoryChanges = this.directoryChanges
          .then(async () => {
            if (this.gateway !== gateway) return;
            await this.handlers?.onParticipantsChanged?.();
            await gateway.directoryChanged(before, current);
          })
          .catch((error: unknown) => this.handlers?.onFatal(error, this.kind));
      });
      this.setConnectionState("connected");
    } catch (error) {
      this.detachAbortSignal();
      if (this.app === app) this.app = undefined;
      if (this.gateway === gateway) this.gateway = undefined;
      try {
        await app?.stop();
      } finally {
        releaseGatewayRuntime(gateway);
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask;
    // Publish the task before aborting: the synchronous abort callback may
    // re-enter disconnect and must join this same shutdown.
    const task = Promise.resolve().then(async () => {
      this.connectionAbort?.abort();
      await this.connectTask?.catch(() => undefined);
      await this.stopResources();
    });
    this.disconnectTask = task;
    try {
      await task;
    } finally {
      this.disconnectTask = undefined;
    }
  }

  private async stopResources(): Promise<void> {
    const app = this.app;
    const gateway = this.gateway;
    this.unsubscribeDirectory?.();
    this.unsubscribeDirectory = undefined;
    this.detachAbortSignal();
    this.app = undefined;
    this.gateway = undefined;
    try {
      await app?.stop();
    } finally {
      if (gateway) releaseGatewayRuntime(gateway);
      this.setConnectionState("stopped");
    }
  }

  async send(
    target: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult> {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    if (target.chatType === "group" && !target.agentId)
      return { kind: "sent", messageId: await gateway.hostNotice(target, content) };
    const record = await gateway.publish(
      target,
      content,
      options?.replyToMessageId,
      options?.media,
      options?.parts,
      options?.task,
      options?.mentionIds,
    );
    return { kind: "sent", messageId: record.id };
  }

  async deleteMessage(target: AgentChannelSource, messageId: string): Promise<AgentChannelSendResult> {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    await gateway.deleteOutboundMessage(messageId, target);
    return { kind: "deleted" };
  }

  async poke(target: AgentChannelSource, task?: AgentChannelTask, targetId?: string): Promise<void> {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    if (target.chatType === "group" && !targetId)
      throw new Error("Select the group participant to poke by their verified channel ID.");
    await gateway.poke(target, gateway.senderAgent(target).qqUserId!, Number(targetId ?? target.userId), task);
  }

  bindHistory(source: AgentChannelSource, key: string, task: AgentChannelTask, preserveExisting = false): void {
    if (!this.gateway) throw new Error("The local OneBot gateway is not connected.");
    this.gateway.bindHistory(source, key, task, preserveExisting);
  }

  resolveMessageTask(source: AgentChannelSource, messageId: string): AgentChannelTask | undefined {
    if (!this.gateway) throw new Error("The local OneBot gateway is not connected.");
    return this.gateway.resolveMessageTask(source, messageId);
  }

  resolveMessageTasks(source: AgentChannelSource, messageId: string): readonly AgentChannelTask[] {
    if (!this.gateway) throw new Error("The local OneBot gateway is not connected.");
    return this.gateway.resolveMessageTasks(source, messageId);
  }

  async readClientTimeline(
    source: AgentChannelSource,
    before?: number,
    limit?: number,
    sync?: AgentChannelTimelineSync,
  ): Promise<AgentChannelTimelinePage> {
    if (!this.gateway) throw new Error("The local OneBot gateway is not connected.");
    return this.gateway.timeline(source, before, limit, sync);
  }

  async readClientConversations(): Promise<readonly AgentChannelClientConversationSummary[]> {
    if (!this.gateway) throw new Error("The local OneBot gateway is not connected.");
    return this.gateway.conversations();
  }

  async readHistory(
    target: AgentChannelSource,
    options?: { readonly limit?: number; readonly beforeMessageId?: string },
  ): Promise<readonly AgentChannelHistoryMessage[]> {
    const gateway = this.gateway;
    if (!gateway) throw new Error("The local OneBot gateway is not connected.");
    return gateway.history(target, options?.limit, options?.beforeMessageId).map((record) => ({
      id: record.id,
      direction: record.direction,
      text: record.text,
      segments: cloneOneBot11Segments(record.segments),
      sentAt: record.sentAt,
      ...(record.senderId ? { senderId: record.senderId } : {}),
      ...(record.displayName ? { displayName: record.displayName } : {}),
    }));
  }

  private setConnectionState(state: AgentChannelConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.handlers?.onConnectionStateChanged?.(state);
  }

  private resolveOperatorDisplayName(): string {
    const value = this.options.resolveOperatorDisplayName().trim();
    if (!value) throw new Error("OneBot requires a non-empty local operator display name.");
    return value;
  }

  private bindAbortSignal(signal: AbortSignal): void {
    this.detachAbortSignal();
    const handler = (): void => {
      void this.disconnect().catch((error: unknown) => this.handlers?.onFatal(error, this.kind));
    };
    this.abortSignal = signal;
    this.abortHandler = handler;
    signal.addEventListener("abort", handler, { once: true });
  }

  private detachAbortSignal(): void {
    const signal = this.abortSignal;
    const handler = this.abortHandler;
    if (signal && handler) signal.removeEventListener("abort", handler);
    this.abortSignal = undefined;
    this.abortHandler = undefined;
  }
}

function ensureGatewayAdapterRegistered(): void {
  if (AdapterRegistry.has(SeneraOneBotPlatform)) return;
  AdapterRegistry.register(SeneraOneBotPlatform, SeneraOneBotGatewayAdapter, {
    name: SeneraOneBotPlatform,
    displayName: "Senera Virtual OneBot",
    description: "Projects Senera channel lanes to a local OneBot 11 client.",
    capabilities: SeneraOneBotCapabilities,
  });
}

function ensureGatewayProtocolRegistered(): void {
  const registered = ProtocolRegistry.get(OneBotProtocolName, OneBotProtocolVersion);
  if (registered === SeneraOneBotV11Protocol) return;
  // The protocol package self-registers its generic implementation at module
  // load. OneBots has no account-scoped action override, so replace only that
  // known implementation before this embedded app creates an account. A
  // different registration belongs to another host integration and must retain
  // ownership instead of being silently replaced.
  if (registered && registered !== OneBotV11Protocol) {
    throw new Error("OneBot v11 is already registered by another runtime integration.");
  }
  if (registered) ProtocolRegistry.unregister(OneBotProtocolName, OneBotProtocolVersion);
  ProtocolRegistry.register(OneBotProtocolName, OneBotProtocolVersion, SeneraOneBotV11Protocol, {
    displayName: "Senera Virtual OneBot 11",
    description: "OneBot 11 protocol projection for the local Senera virtual account.",
  });
  const schemaKey = `${OneBotProtocolName}.${OneBotProtocolVersion}`;
  if (!ProtocolRegistry.getSchema(schemaKey)) {
    ProtocolRegistry.registerSchema(schemaKey, onebotV11Schema);
  }
}

function createEmbeddedApp(runtimeDirectory: string, config: BaseApp.Config): Promise<AgentEmbeddedOneBotApp> {
  const create = (): AgentEmbeddedOneBotApp => {
    const previous = BaseApp.configDir;
    BaseApp.configDir = path.resolve(runtimeDirectory);
    try {
      return new AgentEmbeddedOneBotApp(config, { name: "Senera Virtual OneBot Gateway", version: "1" });
    } finally {
      BaseApp.configDir = previous;
    }
  };
  const task = embeddedAppConstruction.then(create, create);
  embeddedAppConstruction = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function createGatewayRuntimeKey(runtimeDirectory: string, selfId: number): string {
  const location = path.resolve(runtimeDirectory);
  const digest = createHash("sha256").update(`${location}\u0000${selfId}`).digest("hex");
  return `senera-onebot11:${digest}`;
}

function claimGatewayRuntime(gateway: SeneraOneBotGateway): void {
  const active = activeGatewayRuntimes.get(gateway.key);
  if (active && active !== gateway) {
    throw new Error("A local OneBot gateway for this workspace and virtual account is already running.");
  }
  activeGatewayRuntimes.set(gateway.key, gateway);
}

function releaseGatewayRuntime(gateway: SeneraOneBotGateway): void {
  if (activeGatewayRuntimes.get(gateway.key) === gateway) {
    activeGatewayRuntimes.delete(gateway.key);
  }
}

function normalizeHistoryLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, OneBotGatewayDefaults.maximumHistoryEntries)
    : OneBotGatewayDefaults.maximumHistoryEntries;
}

function assertIdentity(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`OneBot ${label} must be a positive integer.`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numericOneBotIdentifier(value: string): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}

interface OneBotGatewayIdentity {
  readonly selfId: number;
  readonly operatorId: number;
}

async function loadOneBotGatewayIdentity(runtimeDirectory: string): Promise<OneBotGatewayIdentity> {
  const identityPath = path.join(runtimeDirectory, "identity.json");
  const persisted = await readOneBotGatewayIdentity(identityPath);
  const selfId = persisted?.selfId ?? nextVirtualIdentity();
  const operatorId = persisted?.operatorId ?? nextVirtualIdentity(selfId);
  assertIdentity(selfId, "selfId");
  assertIdentity(operatorId, "operatorId");
  if (selfId === operatorId) throw new Error("OneBot selfId and operatorId must identify different accounts.");
  const identity = { selfId, operatorId };
  if (!persisted || persisted.selfId !== selfId || persisted.operatorId !== operatorId) {
    await writeFileAtomic(identityPath, `${JSON.stringify(identity, null, 2)}\n`, {
      mode: 0o600,
      directoryMode: 0o700,
      fsync: true,
    });
  }
  return identity;
}

async function readOneBotGatewayIdentity(identityPath: string): Promise<OneBotGatewayIdentity | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(identityPath, "utf8"));
    if (!value || typeof value !== "object") throw new Error("The persisted OneBot identity must be an object.");
    const candidate = value as Partial<OneBotGatewayIdentity>;
    if (
      typeof candidate.selfId !== "number" ||
      typeof candidate.operatorId !== "number" ||
      !Number.isSafeInteger(candidate.selfId) ||
      !Number.isSafeInteger(candidate.operatorId) ||
      candidate.selfId < 1 ||
      candidate.operatorId < 1 ||
      candidate.selfId === candidate.operatorId
    ) {
      throw new Error("The persisted OneBot identity must contain two distinct positive integer account IDs.");
    }
    return { selfId: candidate.selfId, operatorId: candidate.operatorId };
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new Error(
      `Unable to read the local OneBot identity: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

function nextVirtualIdentity(except?: number): number {
  let identity = randomInt(100_000_000, 1_000_000_000);
  while (identity === except) identity = randomInt(100_000_000, 1_000_000_000);
  return identity;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
