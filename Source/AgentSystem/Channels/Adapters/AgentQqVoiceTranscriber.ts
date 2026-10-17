import { randomUUID } from "node:crypto";
import type { AgentChannelAttachment } from "../AgentChannelTypes.js";
import type { AgentChannelHttpTransport } from "../AgentChannelHttpTransport.js";

/**
 * Optional QQ voice-to-text boundary.
 *
 * QQ may include `asr_refer_text` in the event itself. That value is always
 * preferred and this class is only entered when the native transcript is
 * absent. Keeping the external provider here prevents media, gateway and
 * message rendering code from knowing anything about multipart STT APIs.
 */
export interface AgentQqVoiceTranscriberOptions {
  readonly transport: AgentChannelHttpTransport;
  readonly resolveMediaHeaders: () => Promise<Readonly<Record<string, string>>>;
  readonly config?: unknown;
  readonly onFailure?: (error: unknown, attachment: AgentChannelAttachment) => void;
}

interface QqSttConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

const DefaultSttTimeoutMs = 30_000;
const DefaultSttMaxBytes = 25 * 1024 * 1024;

const ProviderDefaults: Readonly<Record<string, { baseUrl: string; model: string }>> = {
  zai: { baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-asr" },
  glm: { baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-asr" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
};

export class AgentQqVoiceTranscriber {
  private readonly transport: AgentChannelHttpTransport;
  private readonly resolveMediaHeaders: AgentQqVoiceTranscriberOptions["resolveMediaHeaders"];
  private readonly config?: QqSttConfig;
  private readonly onFailure?: AgentQqVoiceTranscriberOptions["onFailure"];

  constructor(options: AgentQqVoiceTranscriberOptions) {
    this.transport = options.transport;
    this.resolveMediaHeaders = options.resolveMediaHeaders;
    this.config = resolveSttConfig(options.config);
    this.onFailure = options.onFailure;
  }

  get enabled(): boolean {
    return this.config !== undefined;
  }

  /** Enriches only audio attachments and preserves input ordering. */
  async enrich(
    attachments: readonly AgentChannelAttachment[] | undefined,
  ): Promise<readonly AgentChannelAttachment[] | undefined> {
    if (!attachments?.length || !this.config) return attachments;
    const enriched = await Promise.all(
      attachments.map(async (attachment) => {
        if (!isAudioAttachment(attachment) || attachment.transcript?.trim()) return attachment;
        const transcript = await this.transcribe(attachment);
        return transcript ? { ...attachment, transcript } : attachment;
      }),
    );
    return enriched;
  }

  private async transcribe(attachment: AgentChannelAttachment): Promise<string | undefined> {
    const config = this.config;
    if (!config) return undefined;
    const sourceUrl = normalizeRemoteUrl(attachment.voiceWavUrl ?? attachment.url);
    if (!sourceUrl) return undefined;
    try {
      const mediaResponse = await this.transport.request(sourceUrl, {
        method: "GET",
        headers: await this.resolveMediaHeaders(),
        timeoutMs: config.timeoutMs,
      });
      const bytes = responseBytes(mediaResponse.body, mediaResponse.bytes);
      if (!bytes || bytes.byteLength === 0) return undefined;
      if (bytes.byteLength > config.maxBytes) {
        throw new Error(`QQ voice attachment exceeds the ${config.maxBytes} byte STT limit.`);
      }

      const preconvertedWav = Boolean(attachment.voiceWavUrl);
      const filename = preconvertedWav
        ? "qq-voice.wav"
        : attachment.filename?.trim() || filenameForAudio(attachment, mediaResponse.contentType);
      const contentType = preconvertedWav
        ? "audio/wav"
        : attachment.contentType?.trim() || mediaResponse.contentType || "audio/wav";
      const multipart = createMultipartBody(config.model, filename, contentType, bytes);
      const result = await this.transport.request(`${config.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": multipart.contentType,
          "Content-Length": String(multipart.body.byteLength),
          Accept: "application/json",
        },
        body: multipart.body,
        timeoutMs: config.timeoutMs,
      });
      return extractTranscript(result.body);
    } catch (error) {
      this.onFailure?.(error, attachment);
      return undefined;
    }
  }
}

function resolveSttConfig(value: unknown): QqSttConfig | undefined {
  const raw = isRecord(value) ? value : {};
  if (raw.enabled === false) return undefined;
  const provider = stringValue(raw.provider)?.toLowerCase() ?? "zai";
  const providerDefault = ProviderDefaults[provider] ?? ProviderDefaults.zai;
  const apiKey = stringValue(firstValue(raw.apiKey, raw.api_key, process.env.QQ_STT_API_KEY));
  if (!apiKey) return undefined;
  const baseUrl = normalizeBaseUrl(
    stringValue(firstValue(raw.baseUrl, raw.base_url, process.env.QQ_STT_BASE_URL)) ?? providerDefault.baseUrl,
  );
  if (!baseUrl) return undefined;
  const model = stringValue(firstValue(raw.model, process.env.QQ_STT_MODEL)) ?? providerDefault.model;
  const timeoutMs = boundedPositiveInteger(
    firstValue(raw.timeoutMs, raw.timeout_ms),
    DefaultSttTimeoutMs,
    5_000,
    120_000,
  );
  const maxBytes = boundedPositiveInteger(
    firstValue(raw.maxBytes, raw.max_bytes),
    DefaultSttMaxBytes,
    1_024,
    100 * 1024 * 1024,
  );
  return { baseUrl, apiKey, model, timeoutMs, maxBytes };
}

function isAudioAttachment(attachment: AgentChannelAttachment): boolean {
  if (attachment.mediaType === "audio") return true;
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  const locations = [attachment.filename, attachment.url, attachment.voiceWavUrl];
  return (
    contentType === "voice" ||
    contentType.startsWith("audio/") ||
    locations.some((location) => hasAudioExtension(location))
  );
}

function hasAudioExtension(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return /\.(?:aac|amr|flac|m4a|mp3|ogg|silk|speex|wav)$/u.test(new URL(value).pathname.toLowerCase());
  } catch {
    return /\.(?:aac|amr|flac|m4a|mp3|ogg|silk|speex|wav)(?:[?#]|$)/u.test(value.toLowerCase());
  }
}

function normalizeRemoteUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim().replace(/^\/\//u, "https://");
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value: string): string | undefined {
  const normalized = value.trim().replace(/\/+$/u, "");
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
}

function filenameForAudio(attachment: AgentChannelAttachment, responseContentType?: string): string {
  const extension = extensionForContentType(attachment.contentType ?? responseContentType);
  return `qq-voice.${extension}`;
}

function extensionForContentType(contentType: string | undefined): string {
  const value = contentType?.toLowerCase() ?? "";
  if (value.includes("wav")) return "wav";
  if (value.includes("mp3")) return "mp3";
  if (value.includes("mpeg")) return "mp3";
  if (value.includes("ogg")) return "ogg";
  if (value.includes("mp4") || value.includes("m4a")) return "m4a";
  if (value.includes("amr")) return "amr";
  if (value.includes("silk")) return "silk";
  return "wav";
}

function responseBytes(body: unknown, bytes?: Uint8Array): Uint8Array | undefined {
  if (bytes?.byteLength) return bytes;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") {
    const encoded = body.trim();
    if (!encoded) return undefined;
    try {
      return new Uint8Array(Buffer.from(encoded, "base64"));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractTranscript(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const direct =
    stringValue(body.text) ??
    stringValue(body.transcript) ??
    (isRecord(body.data) ? (stringValue(body.data.text) ?? stringValue(body.data.transcript)) : undefined) ??
    stringValue(body.result);
  if (direct) return direct;
  const choices = body.choices;
  if (!Array.isArray(choices)) return undefined;
  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue;
    const content = stringValue(choice.message.content);
    if (content) return content;
  }
  return undefined;
}

function createMultipartBody(
  model: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): { body: Uint8Array; contentType: string } {
  const boundary = `----senera-qq-${randomUUID().replace(/-/gu, "")}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      `${model}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeFilename(filename)}"\r\n` +
      `Content-Type: ${safeContentType(contentType)}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(bytes, head.byteLength);
  body.set(tail, head.byteLength + bytes.byteLength);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[\r\n"\\]/gu, "_").trim();
  return normalized || "qq-voice.wav";
}

function safeContentType(value: string): string {
  const normalized = value.replace(/[\r\n]/gu, "").trim();
  return normalized || "audio/wav";
}

function firstValue(...values: readonly unknown[]): unknown {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    return value;
  }
  return undefined;
}

function boundedPositiveInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
