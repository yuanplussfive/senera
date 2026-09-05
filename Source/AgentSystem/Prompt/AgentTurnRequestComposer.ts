import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import {
  normalizeAgentInteractionContext,
  type AgentInteractionContext,
} from "../Interaction/AgentInteractionContext.js";

export interface AgentTurnRequestEnvelopeOptions {
  readonly enabled: boolean;
  readonly timeZone: string;
}

export interface AgentTurnRequestComposeInput {
  readonly userInput: string;
  readonly options: AgentTurnRequestEnvelopeOptions;
  readonly attachments?: readonly AgentUploadAttachment[];
  /** Runtime-owned surface/platform context. Never derive this from user text. */
  readonly interaction?: AgentInteractionContext;
  readonly now?: Date;
}

/**
 * Assembles the request-local user message envelope. This is a wire-only
 * concern: storage keeps the clean string, the API receives the structured
 * XML. Any failure degrades to the original input so the turn is never lost.
 */
export function composeAgentTurnRequest(input: AgentTurnRequestComposeInput): string {
  if (!input.options.enabled && !input.interaction) return input.userInput;
  try {
    return composeEnvelope(input);
  } catch {
    return input.userInput;
  }
}

function composeEnvelope(input: AgentTurnRequestComposeInput): string {
  const parts: string[] = ['<user_message attribution="user">'];
  const interaction = normalizeAgentInteractionContext(input.interaction);
  if (interaction) {
    const attributes = [
      `surface="${escapeXml(interaction.surface)}"`,
      interaction.platform ? `platform="${escapeXml(interaction.platform)}"` : "",
      interaction.chatType ? `chat_type="${escapeXml(interaction.chatType)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(`<interaction_context ${attributes} />`);
  }
  if (!input.options.enabled) {
    parts.push(`<content>${escapeXml(input.userInput)}</content>`);
    if (input.attachments && input.attachments.length > 0) appendAttachments(parts, input.attachments);
    parts.push("</user_message>");
    return parts.join("\n");
  }
  const offset = resolveZoneOffset(input.options.timeZone);
  parts.push(
    `<time zone="${escapeXml(input.options.timeZone)}"${offset ? ` offset="${escapeXml(offset)}"` : ""}>${formatZoneTime(input.now ?? new Date(), input.options.timeZone)}</time>`,
  );
  parts.push(`<content>${escapeXml(input.userInput)}</content>`);
  if (input.attachments && input.attachments.length > 0) appendAttachments(parts, input.attachments);
  parts.push("</user_message>");
  return parts.join("\n");
}

function appendAttachments(parts: string[], attachments: readonly AgentUploadAttachment[]): void {
  parts.push("<attachments>");
  for (const attachment of attachments) {
    parts.push(
      `<attachment kind="${escapeXml(attachmentKind(attachment.mime))}" name="${escapeXml(attachment.name)}" mime="${escapeXml(attachment.mime)}" />`,
    );
  }
  parts.push("</attachments>");
}

function attachmentKind(mime: string): string {
  const family = mime.split("/")[0] ?? "other";
  return family === "image" || family === "audio" || family === "video" || family === "text" || family === "application"
    ? family
    : "other";
}

export function formatZoneTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(", ", "T");
}

export function resolveZoneOffset(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName");
    const name = parts?.value ?? "";
    const match = /GMT([+-]\d{1,2}):?(\d{2})?/.exec(name);
    if (match) {
      const sign = match[1].startsWith("-") ? "-" : "+";
      const hours = match[1].slice(1).padStart(2, "0");
      return `${sign}${hours}:${match[2] ?? "00"}`;
    }
  } catch {
    // fall through
  }
  return "";
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
