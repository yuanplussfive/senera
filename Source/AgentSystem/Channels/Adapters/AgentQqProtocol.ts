import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AgentChannelChatTypes,
  AgentChannelKinds,
  type AgentChannelAttachment,
  type AgentChannelKeyboard,
  type AgentChannelKeyboardButton,
  type AgentChannelSource,
} from "../AgentChannelTypes.js";

/** QQ gateway operations. Keeping these values in one protocol module makes
 * transport code independent from message rendering and media upload logic. */
export const QqGatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
  /** QQ webhook callback URL verification challenge. */
  Verify: 13,
} as const;

export const QqGatewayDispatch = {
  Ready: "READY",
  Resumed: "RESUMED",
  C2cMessageCreate: "C2C_MESSAGE_CREATE",
  GroupAtMessageCreate: "GROUP_AT_MESSAGE_CREATE",
  GuildMessageCreate: "GUILD_MESSAGE_CREATE",
  GuildAtMessageCreate: "GUILD_AT_MESSAGE_CREATE",
  DirectMessageCreate: "DIRECT_MESSAGE_CREATE",
  InteractionCreate: "INTERACTION_CREATE",
} as const;

const C2cMessageCreate = 200002;
const GroupAtMessageCreate = 200008;
const ChannelAtMessageCreate = 200012;

export const QqMessageTypes = Object.freeze({ text: 0, markdown: 2, media: 7 });
export const QqMediaTypes = Object.freeze({ image: 1, video: 2, audio: 3, file: 4 });

export const QqFatalCloseCodes = new Set([4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915]);
export const QqSessionResetCloseCodes = new Set([
  4006, 4007, 4900, 4901, 4902, 4903, 4904, 4905, 4906, 4907, 4908, 4909, 4910, 4911, 4912, 4913,
]);

export const QqCallbackSignatures = {
  SignatureHeader: "X-Tsign-Open-Signature",
  TimestampHeader: "X-Tsign-Open-Timestamp",
  NonceHeader: "X-Tsign-Open-Nonce",
} as const;

export interface QqTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

export interface QqGatewayPayload {
  readonly op?: number;
  readonly t?: string;
  readonly s?: number;
  readonly d?: unknown;
}

export interface QqHelloData {
  readonly heartbeat_interval?: number;
}

export interface QqWebhookVerificationData {
  readonly plain_token?: unknown;
  readonly event_ts?: unknown;
}

export interface QqDispatchData {
  readonly id?: string;
  readonly content?: string;
  readonly timestamp?: string;
  readonly author?: {
    readonly user_openid?: string;
    readonly member_openid?: string;
    readonly id?: string;
    readonly username?: string;
    readonly member?: { readonly openid?: string };
  };
  readonly user_openid?: string;
  readonly group_member_openid?: string;
  readonly group_openid?: string;
  readonly channel_id?: string;
  readonly guild_id?: string;
  readonly message_reference?: { readonly message_id?: string };
  readonly referenced_message?: { readonly id?: string };
  readonly attachments?: readonly Record<string, unknown>[];
  /** QQ quote replies expose attachments through msg_elements. */
  readonly msg_elements?: readonly Record<string, unknown>[];
  /** QQ sends 103 as a number, but webhook relays may stringify it. */
  readonly message_type?: number | string;
  readonly msg_seq?: number;
}

export interface QqWebhookEnvelope {
  readonly op?: number;
  readonly t?: string;
  readonly s?: number;
  readonly d?: QqDispatchData | QqWebhookVerificationData;
}

/**
 * Build QQ's callback URL verification response.
 *
 * QQ signs the UTF-8 concatenation of event_ts and plain_token with the app
 * secret and expects the digest as lowercase hexadecimal (not base64, which
 * is used by normal callback request signatures).
 */
export function createQqWebhookVerificationResponse(
  secret: string,
  data: QqWebhookVerificationData,
): { plain_token: string; signature: string } {
  const signingSecret = secret.trim();
  const plainToken = typeof data.plain_token === "string" ? data.plain_token.trim() : "";
  const eventTs = typeof data.event_ts === "string" ? data.event_ts.trim() : String(data.event_ts ?? "").trim();
  if (!signingSecret || !plainToken || !eventTs) {
    throw new Error("QQ webhook verification payload requires event_ts and plain_token.");
  }
  const signature = createHmac("sha256", signingSecret).update(`${eventTs}${plainToken}`, "utf8").digest("hex");
  return { plain_token: plainToken, signature };
}

export interface QqInteractionPayload {
  readonly id?: string;
  readonly type?: number;
  readonly chat_type?: number;
  readonly user_openid?: string;
  readonly group_openid?: string;
  readonly group_member_openid?: string;
  readonly channel_id?: string;
  readonly guild_id?: string;
  readonly data?: {
    readonly type?: number;
    readonly resolved?: {
      readonly button_data?: string;
      readonly button_id?: string;
      readonly user_id?: string;
    };
  };
}

export interface QqUploadPart {
  readonly index: number;
  readonly url: string;
  readonly blockSize?: number;
}

export interface QqUploadPreparation {
  readonly uploadId: string;
  readonly blockSize: number;
  readonly parts: readonly QqUploadPart[];
  readonly concurrency?: number;
  readonly retryTimeoutMs?: number;
}

export interface QqMediaCacheEntry {
  readonly fileInfo: string;
  readonly expiresAt: number;
}

export function parseUploadPreparation(body: unknown): QqUploadPreparation {
  const source = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(source)) throw new Error("QQ upload_prepare returned an invalid response.");
  const uploadId = stringValue(source.upload_id);
  const blockSize = numberValue(source.block_size);
  const concurrency = numberValue(source.concurrency);
  const retryTimeout = numberValue(source.retry_timeout);
  const rawParts = Array.isArray(source.parts) ? source.parts : Array.isArray(source.part_list) ? source.part_list : [];
  const parts = rawParts.flatMap((part) => {
    if (!isRecord(part)) return [];
    const index = numberValue(part.part_index) ?? numberValue(part.index);
    const url = stringValue(part.presigned_url) ?? stringValue(part.url);
    if (!index || !Number.isSafeInteger(index) || index < 1 || !url) return [];
    return [{ index, url, blockSize: numberValue(part.block_size) } satisfies QqUploadPart];
  });
  const uniquePartIndexes = new Set(parts.map((part) => part.index));
  if (uniquePartIndexes.size !== parts.length) throw new Error("QQ upload_prepare returned duplicate part indexes.");
  if (!uploadId || !blockSize || parts.length === 0) throw new Error("QQ upload_prepare returned no usable parts.");
  return {
    uploadId,
    blockSize,
    parts,
    concurrency: concurrency && concurrency > 0 ? Math.min(10, Math.floor(concurrency)) : undefined,
    retryTimeoutMs: retryTimeout && retryTimeout > 0 ? retryTimeout * 1_000 : undefined,
  };
}

export interface QqApprovalRequest {
  readonly sessionKey: string;
  readonly title: string;
  readonly description?: string;
  readonly commandPreview?: string;
  readonly cwd?: string;
  readonly toolName?: string;
  readonly severity?: "critical" | "info" | "";
  readonly timeoutSec?: number;
  readonly allowPermanent?: boolean;
  readonly replyToMessageId?: string;
}

export interface QqUpdatePromptRequest {
  readonly prompt: string;
  readonly yesLabel?: string;
  readonly noLabel?: string;
  readonly replyToMessageId?: string;
}

export function buildTextPayload(
  source: AgentChannelSource,
  content: string,
  replyToMessageId: string | undefined,
  keyboard: AgentChannelKeyboard | undefined,
  markdownSupport: boolean,
  messageSequence: number,
): Record<string, unknown> {
  const isChannel = source.chatType === AgentChannelChatTypes.Channel;
  const payload: Record<string, unknown> =
    isChannel || !markdownSupport
      ? { content, msg_type: QqMessageTypes.text, msg_seq: messageSequence }
      : { markdown: { content }, msg_type: QqMessageTypes.markdown, msg_seq: messageSequence };
  if (replyToMessageId) payload.msg_id = replyToMessageId;
  if (keyboard && !isChannel) payload.keyboard = serializeKeyboard(keyboard);
  return payload;
}

export function serializeKeyboard(keyboard: AgentChannelKeyboard): Record<string, unknown> {
  return { content: { rows: keyboard.rows.map((row) => ({ buttons: row.map(serializeKeyboardButton) })) } };
}

function serializeKeyboardButton(button: AgentChannelKeyboardButton): Record<string, unknown> {
  const actionType = button.action === "link" ? 2 : 1;
  return {
    id: button.id,
    render_data: {
      label: button.label,
      visited_label: button.visitedLabel ?? button.label,
      style: button.style ?? 1,
    },
    action: {
      type: actionType,
      data: button.action === "link" ? (button.url ?? button.data ?? "") : (button.data ?? button.id),
      permission: { type: 2 },
      click_limit: button.clickLimit ?? 1,
    },
    group_id: button.groupId ?? "default",
  };
}

export function createQqApprovalKeyboard(sessionKey: string, allowPermanent = true): AgentChannelKeyboard {
  const safeKey = sessionKey.trim();
  if (!safeKey) throw new Error("QQ approval keyboard requires a session key.");
  const buttons: AgentChannelKeyboardButton[] = [
    {
      id: "allow",
      label: "允许一次",
      visitedLabel: "已允许",
      data: `approve:${safeKey}:allow-once`,
      style: 1,
      groupId: "approval",
    },
  ];
  if (allowPermanent) {
    buttons.push({
      id: "always",
      label: "始终允许",
      visitedLabel: "已始终允许",
      data: `approve:${safeKey}:allow-always`,
      style: 1,
      groupId: "approval",
    });
  }
  buttons.push({
    id: "deny",
    label: "拒绝",
    visitedLabel: "已拒绝",
    data: `approve:${safeKey}:deny`,
    style: 0,
    groupId: "approval",
  });
  return { rows: [buttons] };
}

export function createQqUpdatePromptKeyboard(yesLabel = "确认", noLabel = "取消"): AgentChannelKeyboard {
  return {
    rows: [
      [
        {
          id: "yes",
          label: yesLabel,
          visitedLabel: "已确认",
          data: "update_prompt:y",
          style: 1,
          groupId: "update_prompt",
        },
        {
          id: "no",
          label: noLabel,
          visitedLabel: "已取消",
          data: "update_prompt:n",
          style: 0,
          groupId: "update_prompt",
        },
      ],
    ],
  };
}

export function validateKeyboard(keyboard: AgentChannelKeyboard): void {
  const rows = (keyboard as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5) {
    throw new Error("QQ keyboard must contain between 1 and 5 rows.");
  }
  const ids = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0 || row.length > 5)
      throw new Error("QQ keyboard rows must contain between 1 and 5 buttons.");
    for (const button of row as readonly AgentChannelKeyboardButton[]) {
      if (!button || typeof button.id !== "string" || button.id.trim().length === 0)
        throw new Error("QQ keyboard button id is required.");
      if (ids.has(button.id)) throw new Error(`QQ keyboard button id is duplicated: ${button.id}.`);
      ids.add(button.id);
      if (typeof button.label !== "string" || button.label.trim().length === 0)
        throw new Error(`QQ keyboard button ${button.id} has no label.`);
      if (button.action === "link") {
        let url: URL;
        try {
          url = new URL(button.url ?? button.data ?? "");
        } catch {
          throw new Error(`QQ keyboard link button ${button.id} has an invalid URL.`);
        }
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error(`QQ keyboard link button ${button.id} must use http or https.`);
      } else if (button.data !== undefined && typeof button.data !== "string") {
        throw new Error(`QQ keyboard callback button ${button.id} has invalid data.`);
      }
      if (button.clickLimit !== undefined && (!Number.isSafeInteger(button.clickLimit) || button.clickLimit < 1)) {
        throw new Error(`QQ keyboard button ${button.id} has an invalid click limit.`);
      }
    }
  }
}

export function qqDispatchSource(
  eventType: string,
  data: QqDispatchData,
  forcedKind?: number,
): AgentChannelSource | undefined {
  const userId =
    data.author?.user_openid ??
    data.author?.member_openid ??
    data.author?.member?.openid ??
    data.author?.id ??
    data.user_openid ??
    data.group_member_openid;
  if (!userId) return undefined;
  switch (forcedKind ?? eventKindOf(eventType)) {
    case C2cMessageCreate:
      return {
        platform: AgentChannelKinds.Qq,
        chatType: AgentChannelChatTypes.Direct,
        chatId: userId,
        userId,
        messageId: data.id,
        displayName: data.author?.username,
      };
    case GroupAtMessageCreate:
      return data.group_openid
        ? {
            platform: AgentChannelKinds.Qq,
            chatType: AgentChannelChatTypes.Group,
            chatId: data.group_openid,
            userId,
            messageId: data.id,
            displayName: data.author?.username,
          }
        : undefined;
    case ChannelAtMessageCreate:
      return data.channel_id
        ? {
            platform: AgentChannelKinds.Qq,
            chatType: AgentChannelChatTypes.Channel,
            chatId: data.channel_id,
            userId,
            messageId: data.id,
            displayName: data.author?.username,
          }
        : undefined;
    default:
      return undefined;
  }
}

export function qqInteractionSource(data: QqInteractionPayload): AgentChannelSource | undefined {
  const userId = data.group_member_openid ?? data.user_openid ?? data.data?.resolved?.user_id;
  if (!userId) return undefined;
  const chatType =
    data.chat_type === 2
      ? AgentChannelChatTypes.Direct
      : data.chat_type === 1
        ? AgentChannelChatTypes.Group
        : AgentChannelChatTypes.Channel;
  const chatId =
    chatType === AgentChannelChatTypes.Direct
      ? userId
      : chatType === AgentChannelChatTypes.Group
        ? data.group_openid
        : data.channel_id;
  if (!chatId) return undefined;
  return { platform: AgentChannelKinds.Qq, chatType, chatId, userId };
}

function eventKindOf(eventType: string): number {
  switch (eventType) {
    case QqGatewayDispatch.C2cMessageCreate:
      return C2cMessageCreate;
    case QqGatewayDispatch.GroupAtMessageCreate:
      return GroupAtMessageCreate;
    case QqGatewayDispatch.GuildMessageCreate:
    case QqGatewayDispatch.GuildAtMessageCreate:
    case QqGatewayDispatch.DirectMessageCreate:
      return ChannelAtMessageCreate;
    default:
      return 0;
  }
}

export function inferWebhookEventType(data: QqDispatchData): string {
  if (data.group_openid) return QqGatewayDispatch.GroupAtMessageCreate;
  if (data.channel_id) return QqGatewayDispatch.GuildMessageCreate;
  return QqGatewayDispatch.C2cMessageCreate;
}

export function isLegacyWebhookSink(value: number): boolean {
  return value === C2cMessageCreate || value === GroupAtMessageCreate || value === ChannelAtMessageCreate;
}

export function messageEndpoint(source: AgentChannelSource): string | undefined {
  switch (source.chatType) {
    case AgentChannelChatTypes.Direct:
      return `/v2/users/${encodeURIComponent(source.userId)}/messages`;
    case AgentChannelChatTypes.Group:
      return `/v2/groups/${encodeURIComponent(source.chatId)}/messages`;
    case AgentChannelChatTypes.Channel:
      return `/channels/${encodeURIComponent(source.chatId)}/messages`;
    default:
      return undefined;
  }
}

export function mediaMessageEndpoint(source: AgentChannelSource): string | undefined {
  if (source.chatType === AgentChannelChatTypes.Direct)
    return `/v2/users/${encodeURIComponent(source.userId)}/messages`;
  if (source.chatType === AgentChannelChatTypes.Group)
    return `/v2/groups/${encodeURIComponent(source.chatId)}/messages`;
  return undefined;
}

export function uploadEndpoint(source: AgentChannelSource): string | undefined {
  if (source.chatType === AgentChannelChatTypes.Direct) return `/v2/users/${encodeURIComponent(source.userId)}`;
  if (source.chatType === AgentChannelChatTypes.Group) return `/v2/groups/${encodeURIComponent(source.chatId)}`;
  return undefined;
}

export function normalizeQqAttachments(
  raw: readonly Record<string, unknown>[] | undefined,
): AgentChannelAttachment[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const attachments = raw.flatMap((item) => {
    const rawUrl = stringValue(item.url) ?? stringValue(item.file_url) ?? stringValue(item.download_url);
    const url = rawUrl?.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    const filename = stringValue(item.filename) ?? stringValue(item.file_name);
    const rawContentType = stringValue(item.content_type) ?? stringValue(item.contentType);
    const rawVoiceWavUrl = stringValue(item.voice_wav_url) ?? stringValue(item.voiceWavUrl);
    const voiceWavUrl = rawVoiceWavUrl?.startsWith("//") ? `https:${rawVoiceWavUrl}` : rawVoiceWavUrl;
    const contentType = normalizeQqContentType(rawContentType, filename, url, voiceWavUrl);
    const mediaType = inferQqMediaType(rawContentType, filename, url, voiceWavUrl);
    const transcript = stringValue(item.asr_refer_text) ?? stringValue(item.transcript);
    if (!url && !filename && !transcript && !voiceWavUrl) return [];
    return [
      {
        id: stringValue(item.id),
        url,
        filename,
        contentType,
        mediaType,
        size: numberValue(item.size) ?? numberValue(item.file_size),
        width: numberValue(item.width),
        height: numberValue(item.height),
        durationMs: durationMsOf(item.duration_ms ?? item.duration),
        altText: stringValue(item.alt_text) ?? stringValue(item.description),
        transcript,
        voiceWavUrl,
      } satisfies AgentChannelAttachment,
    ];
  });
  return attachments.length > 0 ? attachments : undefined;
}

/** QQ quote replies (message_type 103) put quoted media in msg_elements. */
export function collectQqAttachments(data: QqDispatchData): readonly Record<string, unknown>[] | undefined {
  const direct = Array.isArray(data.attachments) ? [...data.attachments] : [];
  if (!isQuotedQqMessage(data) || !Array.isArray(data.msg_elements)) return direct.length > 0 ? direct : undefined;
  for (const element of data.msg_elements) {
    if (!isRecord(element) || !Array.isArray(element.attachments)) continue;
    for (const attachment of element.attachments) {
      if (isRecord(attachment) && !direct.some((candidate) => sameAttachment(candidate, attachment)))
        direct.push(attachment);
    }
  }
  return direct.length > 0 ? direct : undefined;
}

/**
 * Returns the quoted text marker that Hermes exposes to the model for QQ's
 * message_type=103 replies. Keeping this beside attachment collection avoids
 * dropping the referenced message when the quote has no new user text.
 */
export function quotedQqContent(data: QqDispatchData): string | undefined {
  if (!isQuotedQqMessage(data) || !Array.isArray(data.msg_elements)) return undefined;
  const parts: string[] = [];
  let hasAttachment = false;
  for (const element of data.msg_elements) {
    if (!isRecord(element)) continue;
    const content = stringValue(element.content)?.trim();
    if (content) parts.push(content);
    if (Array.isArray(element.attachments) && element.attachments.some(isRecord)) hasAttachment = true;
  }
  if (parts.length === 0 && !hasAttachment) return undefined;
  if (hasAttachment) parts.push(parts.length > 0 ? "[附件]" : "（附件）");
  return `[引用消息]\n${parts.join("\n")}`;
}

function isQuotedQqMessage(data: QqDispatchData): boolean {
  return Number(data.message_type) === 103;
}

function sameAttachment(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftIdentity = stringValue(left.id) ?? stringValue(left.url) ?? stringValue(left.file_url);
  const rightIdentity = stringValue(right.id) ?? stringValue(right.url) ?? stringValue(right.file_url);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

function inferQqMediaType(
  contentType: string | undefined,
  filename: string | undefined,
  ...locations: readonly (string | undefined)[]
): AgentChannelAttachment["mediaType"] {
  const value = `${contentType ?? ""} ${filename ?? ""} ${locations.filter(Boolean).join(" ")}`.toLowerCase();
  if (
    value.includes("image") ||
    locations.some((location) => hasExtension(location, /\.(?:png|jpe?g|gif|webp|bmp|heic)$/u))
  )
    return "image";
  if (value.includes("video") || locations.some((location) => hasExtension(location, /\.(?:mp4|mov|webm|mkv|avi)$/u)))
    return "video";
  if (
    value.includes("audio") ||
    value.includes("voice") ||
    locations.some((location) => hasExtension(location, /\.(?:aac|amr|flac|m4a|mp3|ogg|silk|speex|wav)$/u))
  )
    return "audio";
  return filename || contentType ? "file" : undefined;
}

function normalizeQqContentType(
  contentType: string | undefined,
  filename: string | undefined,
  ...locations: readonly (string | undefined)[]
): string | undefined {
  if (contentType && contentType !== "voice") return contentType;
  if (contentType === "voice") return "audio/amr";
  const candidates = [filename, ...locations];
  if (candidates.some((candidate) => hasExtension(candidate, /\.silk$/u))) return "audio/silk";
  if (candidates.some((candidate) => hasExtension(candidate, /\.wav$/u))) return "audio/wav";
  if (candidates.some((candidate) => hasExtension(candidate, /\.amr$/u))) return "audio/amr";
  if (candidates.some((candidate) => hasExtension(candidate, /\.mp3$/u))) return "audio/mpeg";
  if (candidates.some((candidate) => hasExtension(candidate, /\.(?:m4a|mp4)$/u))) return "audio/mp4";
  if (candidates.some((candidate) => hasExtension(candidate, /\.ogg$/u))) return "audio/ogg";
  if (candidates.some((candidate) => hasExtension(candidate, /\.flac$/u))) return "audio/flac";
  return contentType;
}

function hasExtension(value: string | undefined, pattern: RegExp): boolean {
  if (!value) return false;
  try {
    return pattern.test(new URL(value).pathname.toLowerCase());
  } catch {
    return pattern.test(value.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "");
  }
}

function durationMsOf(value: unknown): number | undefined {
  const duration = numberValue(value);
  if (duration === undefined || duration < 0) return undefined;
  return duration < 1_000 ? Math.round(duration * 1_000) : Math.round(duration);
}

export function sourceKey(source: AgentChannelSource): string {
  return `${source.chatType}/${source.chatId}/${source.userId}/${source.threadId ?? ""}`;
}

export function cleanQqContent(content: string): string {
  // Only remove a leading bot mention. Mentions in the user's actual text are
  // meaningful and should remain visible to the model.
  return content
    .replace(/^\s*(?:<@!?[^>]+>\s*)+/u, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function verifyQqSignature(
  rawBody: string,
  headers: Record<string, string | string[]>,
  secret: string,
): boolean {
  const signature = headerValue(headers, QqCallbackSignatures.SignatureHeader);
  const timestamp = headerValue(headers, QqCallbackSignatures.TimestampHeader);
  const nonce = headerValue(headers, QqCallbackSignatures.NonceHeader);
  if (!signature || !timestamp || !nonce) return false;
  const message = `${nonce}\n${timestamp}\n${rawBody}`;
  const computed = createHmac("sha256", secret).update(message, "utf8").digest("base64");
  const expected = Buffer.from(computed, "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function defaultQqIntents(): number {
  return (1 << 25) | (1 << 26) | (1 << 12) | (1 << 30);
}

export function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

export function retryAfterOf(body: unknown): number | undefined {
  if (!isRecord(body)) return undefined;
  const value = body.retry_after;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function sanitizeGatewayUrl(url: string): string {
  return url
    .trim()
    .replace(/\/$/, "")
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
}

export function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

export function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
