import { CQCode } from "@onebots/protocol-onebot-v11";
import type { CommonTypes } from "onebots";
import { normalizeAgentResourceUri } from "../../Resources/AgentResourceUri.js";
import type {
  AgentChannelAttachment,
  AgentChannelMedia,
  AgentChannelMessageSegment,
  AgentChannelOutboundSegment,
} from "../AgentChannelTypes.js";

/**
 * The virtual gateway accepts the same ordered OneBot segment stream that a
 * normal OneBot client sends. CQ serialization belongs to the protocol
 * library; binary payloads cross the ordinary upload boundary.
 */
export interface AgentOneBot11InboundProjection {
  readonly text: string;
  readonly segments: readonly AgentChannelMessageSegment[];
  readonly attachments?: readonly AgentChannelAttachment[];
  readonly replyToMessageId?: string;
}

const MediaKinds = Object.freeze({
  image: "image",
  record: "audio",
  audio: "audio",
  video: "video",
  file: "file",
} as const);

type MediaSegmentType = keyof typeof MediaKinds;

/** Makes a detached, JSON-safe copy suitable for storage and replay. */
export function cloneOneBot11Segments(segments: readonly CommonTypes.Segment[]): CommonTypes.Segment[] {
  return segments.map((segment) => ({
    type: requiredSegmentType(segment.type),
    data: cloneJsonRecord(segment.data),
  }));
}

/** Returns the actual text parts while retaining all other parts separately. */
export function projectOneBot11InboundMessage(
  source: readonly CommonTypes.Segment[],
  options?: { readonly origin?: "external" },
): AgentOneBot11InboundProjection {
  const segments = cloneOneBot11Segments(source);
  const attachments: AgentChannelAttachment[] = [];
  let replyToMessageId: string | undefined;
  const projected = segments.map((segment, index) => {
    const attachment = projectAttachment(segment, index, options?.origin === "external");
    if (attachment) attachments.push(attachment);
    if (segment.type === "reply" && replyToMessageId === undefined) {
      replyToMessageId = scalarString(segment.data.id);
    }
    return {
      type: segment.type,
      data: attachment ? redactInlinePayload(segment.data, attachment) : segment.data,
    } satisfies AgentChannelMessageSegment;
  });
  return {
    text: CQCode.stringify(segments.filter((segment) => !isMediaSegmentType(segment.type))),
    segments: projected,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  };
}

/** OneBot's canonical raw-message representation for event compatibility. */
export function stringifyOneBot11Segments(segments: readonly CommonTypes.Segment[]): string {
  return CQCode.stringify(cloneOneBot11Segments(segments));
}

/**
 * Converts Senera's channel-media boundary into the wire segments understood
 * by OneBot clients. A virtual gateway must retain an actual transport source
 * for every media item: a Senera resource URI is intentionally not enough for
 * an independent OneBot client to dereference.
 */
export function projectOneBot11OutboundMessage(input: {
  readonly text: string;
  readonly replyToMessageId?: string;
  readonly media?: readonly AgentChannelMedia[];
  readonly parts?: readonly AgentChannelOutboundSegment[];
  readonly mentionIds?: readonly string[];
}): CommonTypes.Segment[] {
  const segments: CommonTypes.Segment[] = [];
  if (input.replyToMessageId) {
    segments.push({ type: "reply", data: { id: input.replyToMessageId } });
  }
  for (const id of input.mentionIds ?? []) {
    segments.push({ type: "at", data: { qq: id } }, { type: "text", data: { text: " " } });
  }
  const parts = input.parts ?? [
    ...(input.text.length ? [{ kind: "text" as const, content: input.text }] : []),
    ...(input.media ?? []).map((media) => ({ kind: "media" as const, media })),
  ];
  for (const part of parts) {
    segments.push(
      part.kind === "text" ? { type: "text", data: { text: part.content } } : projectOneBot11OutboundMedia(part.media),
    );
  }
  if (segments.length === 0) {
    throw new Error("OneBot messages require text, media, or a reply target.");
  }
  return segments;
}

function projectOneBot11OutboundMedia(media: AgentChannelMedia): CommonTypes.Segment {
  const file = media.url ?? media.data ?? media.path;
  if (!file) {
    throw new Error(`OneBot cannot deliver ${media.kind} media without a URL, inline payload, or local file path.`);
  }
  const type = media.kind === "audio" ? "record" : media.kind;
  const data: Record<string, unknown> = {
    file,
    ...(media.url ? { url: media.url } : {}),
    ...(media.filename ? { name: media.filename } : {}),
    ...(media.contentType ? { content_type: media.contentType } : {}),
    ...(media.size !== undefined ? { size: media.size } : {}),
    ...(media.altText ? { summary: media.altText } : {}),
  };
  return { type, data };
}

function projectAttachment(
  segment: CommonTypes.Segment,
  index: number,
  external = false,
): AgentChannelAttachment | undefined {
  if (!isMediaSegmentType(segment.type)) return undefined;
  const resourceUri =
    !external && typeof segment.data.file === "string" ? normalizeAgentResourceUri(segment.data.file) : undefined;
  const inline = readInlineData(segment.data.file) ?? readInlineData(segment.data.url);
  const candidateUrl = readWebUrl(segment.data.url) ?? readWebUrl(segment.data.file);
  const url = inline || (external && candidateUrl?.startsWith("/")) ? undefined : candidateUrl;
  const nativeId = !resourceUri && !inline && !url && external ? scalarString(segment.data.file) : undefined;
  if (!resourceUri && !inline && !url && !nativeId)
    throw new Error(`OneBot ${segment.type} media has no readable resource, URL or inline payload.`);
  const filename = fileNameFromSegment(segment.data, segment.type, index);
  const contentType = inline?.contentType ?? contentTypeFromSegment(segment.data);
  return {
    id: `onebot-segment-${index + 1}`,
    ...(nativeId ? { nativeId } : {}),
    ...(resourceUri ? { resourceUri } : url ? { url } : {}),
    ...(inline ? { inlineData: { encoding: "base64" as const, data: inline.data } } : {}),
    filename,
    ...(contentType ? { contentType } : {}),
    mediaType: MediaKinds[segment.type],
    ...(typeof segment.data.size === "number" && Number.isSafeInteger(segment.data.size) && segment.data.size >= 0
      ? { size: segment.data.size }
      : {}),
  };
}

function redactInlinePayload(
  data: Readonly<Record<string, unknown>>,
  attachment: AgentChannelAttachment,
): Readonly<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...data, attachmentId: attachment.id };
  for (const key of ["file", "url"] as const) {
    if (readInlineData(data[key])) {
      delete next[key];
    }
  }
  return next;
}

function readInlineData(value: unknown): { readonly data: string; readonly contentType?: string } | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("base64://")) {
    const data = value.slice("base64://".length);
    return data ? { data } : undefined;
  }
  const match = /^data:([^;,]+)?;base64,([\s\S]+)$/u.exec(value);
  if (!match) return undefined;
  const data = match[2];
  return data ? { data, ...(match[1] ? { contentType: match[1] } : {}) } : undefined;
}

function readWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  // The host may publish owned media as a same-origin absolute path. The media
  // store resolves these references before the normal attachment ingestion.
  return /^(?:https?:\/\/|\/)/u.test(candidate) ? candidate : undefined;
}

function contentTypeFromSegment(data: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ["content_type", "contentType", "mime", "mime_type"] as const) {
    const value = scalarString(data[key]);
    if (value) return value;
  }
  return undefined;
}

function fileNameFromSegment(data: Readonly<Record<string, unknown>>, type: string, index: number): string {
  for (const key of ["file_name", "filename", "name"] as const) {
    const value = scalarString(data[key]);
    if (value) return value;
  }
  const file = scalarString(data.file);
  if (file && !readInlineData(file) && !readWebUrl(file)) return file;
  return `onebot-${type}-${index + 1}`;
}

function requiredSegmentType(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("OneBot message segment type must be a non-empty string.");
  return value;
}

function cloneJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OneBot message segment data must be an object.");
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]));
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("OneBot message segment data cannot contain a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (typeof value === "object") return cloneJsonRecord(value);
  throw new Error(`OneBot message segment data cannot contain ${typeof value}.`);
}

function scalarString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}

export function isMediaSegmentType(value: string): value is MediaSegmentType {
  return Object.hasOwn(MediaKinds, value);
}
