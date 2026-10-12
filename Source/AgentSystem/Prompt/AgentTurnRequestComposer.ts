import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import {
  normalizeAgentInteractionContext,
  type AgentInteractionContext,
} from "../Interaction/AgentInteractionContext.js";

export interface AgentTurnRequestEnvelopeOptions {
  readonly enabled: boolean;
  readonly timeZone: string;
}

/**
 * A request-local attachment reference. The canonical URI is always retained
 * as the durable fallback; a resolved local path is an ephemeral convenience
 * for the model and must never be persisted in conversation history.
 */
export interface AgentTurnAttachmentReference {
  readonly resourceUri: string;
  readonly filePath?: string;
}

export type AgentTurnAttachmentUploadStore = Pick<AgentUploadStore, "resolve"> &
  Partial<Pick<AgentUploadStore, "resolvePath">>;

export interface AgentTurnRequestComposeInput {
  readonly userInput: string;
  readonly options: AgentTurnRequestEnvelopeOptions;
  readonly attachments?: readonly AgentUploadAttachment[];
  readonly attachmentReferences?: readonly AgentTurnAttachmentReference[];
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
  if (!input.options.enabled && !input.interaction && (input.attachments?.length ?? 0) === 0) {
    return input.userInput;
  }
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
    if (input.attachments && input.attachments.length > 0) {
      appendAttachments(parts, input.attachments, input.attachmentReferences);
    }
    parts.push("</user_message>");
    return parts.join("\n");
  }
  const offset = resolveZoneOffset(input.options.timeZone);
  parts.push(
    `<time zone="${escapeXml(input.options.timeZone)}"${offset ? ` offset="${escapeXml(offset)}"` : ""}>${formatZoneTime(input.now ?? new Date(), input.options.timeZone)}</time>`,
  );
  parts.push(`<content>${escapeXml(input.userInput)}</content>`);
  if (input.attachments && input.attachments.length > 0) {
    appendAttachments(parts, input.attachments, input.attachmentReferences);
  }
  parts.push("</user_message>");
  return parts.join("\n");
}

function appendAttachments(
  parts: string[],
  attachments: readonly AgentUploadAttachment[],
  references?: readonly AgentTurnAttachmentReference[],
): void {
  parts.push("<attachments>");
  for (const attachment of attachments) {
    const reference = references?.find((candidate) => candidate.resourceUri === attachment.resourceUri);
    const attributes = [
      `kind="${escapeXml(attachmentKind(attachment.mime))}"`,
      `name="${escapeXml(attachment.name)}"`,
      `mime="${escapeXml(attachment.mime)}"`,
      `size="${attachment.size}"`,
    ].join(" ");
    const children = [
      reference?.filePath ? `<local_path>${escapeXml(reference.filePath)}</local_path>` : "",
      `<resource_uri>${escapeXml(attachment.resourceUri)}</resource_uri>`,
    ].filter(Boolean);
    parts.push(`<attachment ${attributes}>`, ...children, "</attachment>");
  }
  parts.push("</attachments>");
}

/**
 * Resolves upload-backed attachments just before a Pi turn is sent. Failure
 * of one stale upload is deliberately isolated: the canonical URI remains in
 * the prompt so resource-aware tools can still report a useful error.
 */
export async function resolveAgentTurnAttachmentReferences(
  attachments: readonly AgentUploadAttachment[] | undefined,
  uploadStore: AgentTurnAttachmentUploadStore | undefined,
): Promise<readonly AgentTurnAttachmentReference[]> {
  if (!attachments || attachments.length === 0) return [];

  return Promise.all(
    attachments.map(async (attachment) => {
      if (!uploadStore) return { resourceUri: attachment.resourceUri };
      try {
        const localPath = uploadStore.resolvePath
          ? await uploadStore.resolvePath(attachment.resourceUri)
          : (await uploadStore.resolve(attachment.resourceUri))?.filePath;
        return {
          resourceUri: attachment.resourceUri,
          ...(localPath ? { filePath: localPath } : {}),
        };
      } catch {
        return { resourceUri: attachment.resourceUri };
      }
    }),
  );
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
