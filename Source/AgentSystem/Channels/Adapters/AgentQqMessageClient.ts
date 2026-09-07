import {
  AgentChannelChatTypes,
  type AgentChannelConnectionState,
  type AgentChannelKeyboard,
  type AgentChannelMedia,
  type AgentChannelSendReplyOptions,
  type AgentChannelSendResult,
  type AgentChannelSource,
} from "../AgentChannelTypes.js";
import { convertAgentChannelMarkdown, splitAgentChannelContent } from "../AgentChannelText.js";
import type { AgentQqRestClient } from "./AgentQqRestClient.js";
import {
  QqMessageTypes,
  buildTextPayload,
  createQqApprovalKeyboard,
  createQqUpdatePromptKeyboard,
  mediaMessageEndpoint,
  messageEndpoint,
  serializeKeyboard,
  sourceKey,
  stringValue,
  validateKeyboard,
  type QqApprovalRequest,
  type QqUpdatePromptRequest,
} from "./AgentQqProtocol.js";
import type { QqMediaUploader } from "./AgentQqMediaUploader.js";

export interface AgentQqMessageClientOptions {
  readonly rest: AgentQqRestClient;
  readonly mediaUploader: QqMediaUploader;
  readonly maxMessageLength: number;
  readonly markdownSupport: boolean;
  readonly typingDebounceMs: number;
  readonly now: () => Date;
  readonly waitForAvailability: () => Promise<void>;
  readonly getConnectionState: () => AgentChannelConnectionState;
}

/**
 * QQ outbound message boundary. It owns message sequencing and rich-message
 * details while the adapter remains focused on Gateway and inbound routing.
 */
export class AgentQqMessageClient {
  private readonly rest: AgentQqRestClient;
  private readonly mediaUploader: QqMediaUploader;
  private readonly maxMessageLength: number;
  private readonly markdownSupport: boolean;
  private readonly typingDebounceMs: number;
  private readonly now: () => Date;
  private readonly waitForAvailability: () => Promise<void>;
  private readonly getConnectionState: () => AgentChannelConnectionState;
  private readonly messageSequences = new Map<string, number>();
  private readonly typingSentAt = new Map<string, number>();
  private readonly latestMessageIds = new Map<string, string>();

  constructor(options: AgentQqMessageClientOptions) {
    this.rest = options.rest;
    this.mediaUploader = options.mediaUploader;
    this.maxMessageLength = options.maxMessageLength;
    this.markdownSupport = options.markdownSupport;
    this.typingDebounceMs = options.typingDebounceMs;
    this.now = options.now;
    this.waitForAvailability = options.waitForAvailability;
    this.getConnectionState = options.getConnectionState;
  }

  rememberInboundMessage(source: AgentChannelSource, messageId: string): void {
    this.latestMessageIds.set(sourceKey(source), messageId);
  }

  async send(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult> {
    return this.sendPrepared(source, content, options, false);
  }

  private async sendPrepared(
    source: AgentChannelSource,
    content: string,
    options: AgentChannelSendReplyOptions | undefined,
    attachCaptionToMedia: boolean,
  ): Promise<AgentChannelSendResult> {
    await this.waitForAvailability();
    const media = options?.media ?? [];
    if (options?.keyboard) validateKeyboard(options.keyboard);
    const formatted = convertAgentChannelMarkdown(content, this.markdownSupport ? "markdown" : "plain");
    if (!formatted.trim() && media.length === 0) return { kind: "unsupported" };
    const chunks = formatted.length > 0 ? splitAgentChannelContent(formatted, this.maxMessageLength) : [""];
    const replyTo = options?.replyToMessageId ?? source.messageId;
    let last: AgentChannelSendResult = { kind: "unsupported" };
    let first = true;
    if (attachCaptionToMedia) {
      // The explicit media-message API is the only path that attaches a
      // caption to an upload. This keeps captions intentional and prevents
      // ordinary mixed answers from being duplicated by the QQ renderer.
      for (const [index, item] of media.entries()) {
        const caption = index === 0 ? chunks[0] : undefined;
        last = await this.sendMedia(
          source,
          item,
          caption,
          first ? replyTo : undefined,
          first && caption ? options?.keyboard : undefined,
        );
        first = false;
      }
      for (const chunk of chunks.slice(1).filter((item) => item.trim())) {
        last = await this.sendText(source, chunk, first ? replyTo : undefined, first ? options?.keyboard : undefined);
        first = false;
      }
    } else {
      // A single adapter call cannot represent an interleaved stream. The
      // shared renderer therefore enqueues one job per ordered segment; for
      // callers that provide both fields, text remains the authored payload
      // and is sent before the independent media attachments.
      for (const chunk of chunks.filter((item) => item.trim())) {
        last = await this.sendText(source, chunk, first ? replyTo : undefined, first ? options?.keyboard : undefined);
        first = false;
      }
      for (const item of media) {
        last = await this.sendMedia(
          source,
          item,
          undefined,
          first ? replyTo : undefined,
          first ? options?.keyboard : undefined,
        );
        first = false;
      }
    }
    return last;
  }

  async sendWithKeyboard(
    source: AgentChannelSource,
    content: string,
    keyboard: AgentChannelKeyboard,
    replyToMessageId?: string,
  ): Promise<AgentChannelSendResult> {
    if (source.chatType === AgentChannelChatTypes.Channel) return { kind: "unsupported" };
    validateKeyboard(keyboard);
    await this.waitForAvailability();
    const formatted = convertAgentChannelMarkdown(content, this.markdownSupport ? "markdown" : "plain");
    const chunks = splitAgentChannelContent(formatted, this.maxMessageLength);
    let last = await this.sendText(source, chunks[0] ?? "", replyToMessageId ?? source.messageId, keyboard);
    // QQ keyboards belong to one message. Send the remaining chunks as normal
    // messages instead of silently truncating an approval/update prompt.
    for (const chunk of chunks.slice(1)) {
      last = await this.sendText(source, chunk);
    }
    return last;
  }

  async sendApprovalRequest(source: AgentChannelSource, request: QqApprovalRequest): Promise<AgentChannelSendResult> {
    const title = request.commandPreview || request.cwd ? "🔐 命令执行审批" : "🛡️ 审批请求";
    const lines = [title, "", request.title.trim()];
    if (request.commandPreview?.trim()) lines.push("", "```", request.commandPreview.trim().slice(0, 300), "```");
    if (request.cwd?.trim()) lines.push(`目录：${request.cwd.trim()}`);
    if (request.toolName?.trim()) lines.push(`工具：${request.toolName.trim()}`);
    if (request.description?.trim()) lines.push(request.description.trim());
    const timeout = request.timeoutSec ?? 120;
    lines.push("", `有效期：${Number.isFinite(timeout) ? Math.max(1, Math.floor(timeout)) : 120} 秒`);
    return this.sendWithKeyboard(
      source,
      lines.join("\n"),
      createQqApprovalKeyboard(request.sessionKey, request.allowPermanent !== false),
      request.replyToMessageId,
    );
  }

  async sendUpdatePrompt(source: AgentChannelSource, request: QqUpdatePromptRequest): Promise<AgentChannelSendResult> {
    return this.sendWithKeyboard(
      source,
      request.prompt,
      createQqUpdatePromptKeyboard(request.yesLabel, request.noLabel),
      request.replyToMessageId,
    );
  }

  sendExecApproval(source: AgentChannelSource, request: QqApprovalRequest): Promise<AgentChannelSendResult> {
    return this.sendApprovalRequest(source, request);
  }

  sendMediaMessage(
    source: AgentChannelSource,
    media: AgentChannelMedia,
    caption = "",
    options?: Pick<AgentChannelSendReplyOptions, "replyToMessageId" | "keyboard">,
  ): Promise<AgentChannelSendResult> {
    return this.sendPrepared(
      source,
      caption,
      {
        chatType: source.chatType,
        replyToMessageId: options?.replyToMessageId,
        keyboard: options?.keyboard,
        media: [media],
      },
      true,
    );
  }

  async sendTyping(source: AgentChannelSource): Promise<void> {
    const state = this.getConnectionState();
    if (state === "stopped" || state === "degraded") return;
    if (source.chatType !== AgentChannelChatTypes.Direct) return;
    const endpoint = messageEndpoint(source);
    const messageId = this.latestMessageIds.get(sourceKey(source)) ?? source.messageId;
    if (!endpoint || !messageId) return;
    const key = sourceKey(source);
    const now = this.now().getTime();
    const lastSent = this.typingSentAt.get(key) ?? 0;
    if (now - lastSent < this.typingDebounceMs) return;
    try {
      await this.rest.request(
        endpoint,
        "POST",
        {
          msg_type: 6,
          msg_id: messageId,
          input_notify: { input_type: 1, input_second: 60 },
          msg_seq: this.nextMessageSequence(source),
        },
        15_000,
      );
      this.typingSentAt.set(key, now);
    } catch {
      // Presence is cosmetic. A stale source message must not fail a turn.
    }
  }

  edit(_source: AgentChannelSource, _messageId: string, _content: string): Promise<AgentChannelSendResult> {
    return Promise.resolve({ kind: "unsupported" });
  }

  private async sendText(
    source: AgentChannelSource,
    content: string,
    replyToMessageId?: string,
    keyboard?: AgentChannelKeyboard,
  ): Promise<AgentChannelSendResult> {
    const endpoint = messageEndpoint(source);
    if (!endpoint) throw new Error(`QQ send unsupported for lane: ${source.chatType}/${source.chatId}.`);
    const payload = buildTextPayload(
      source,
      content,
      replyToMessageId,
      keyboard,
      this.markdownSupport,
      this.nextMessageSequence(source),
    );
    const response = (await this.rest.request(endpoint, "POST", payload, 15_000)) as { id?: unknown };
    const messageId = stringValue(response?.id);
    return messageId ? { kind: "sent", messageId } : { kind: "unsupported" };
  }

  private async sendMedia(
    source: AgentChannelSource,
    media: AgentChannelMedia,
    caption?: string,
    replyToMessageId?: string,
    keyboard?: AgentChannelKeyboard,
  ): Promise<AgentChannelSendResult> {
    const endpoint = mediaMessageEndpoint(source);
    if (!endpoint) throw new Error("QQ native media is available in direct and group conversations only.");
    const fileInfo = await this.mediaUploader.upload(source, media);
    const payload: Record<string, unknown> = {
      msg_type: QqMessageTypes.media,
      media: { file_info: fileInfo },
      msg_seq: this.nextMessageSequence(source),
    };
    if (caption) payload.content = caption.slice(0, this.maxMessageLength);
    if (replyToMessageId) payload.msg_id = replyToMessageId;
    if (keyboard) payload.keyboard = serializeKeyboard(keyboard);
    const response = (await this.rest.request(endpoint, "POST", payload, 15_000)) as { id?: unknown };
    const messageId = stringValue(response?.id);
    return messageId ? { kind: "sent", messageId } : { kind: "unsupported" };
  }

  private nextMessageSequence(source: AgentChannelSource): number {
    const key = sourceKey(source);
    const next = ((this.messageSequences.get(key) ?? 0) % 65_535) + 1;
    this.messageSequences.set(key, next);
    return next;
  }
}

export type { QqApprovalRequest, QqUpdatePromptRequest } from "./AgentQqProtocol.js";
