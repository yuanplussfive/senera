import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentConversationEntryMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { AgentUploadAttachmentListSchema, type AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { EntryRow } from "./AgentSessionSqlRows.js";

export interface EncodedEntryRow {
  id: string;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  sequence: number;
  data: string;
}

export function entryToRow(sessionId: string, entry: AgentConversationEntry, sequence: number): EncodedEntryRow {
  const data = encodeEntryData(entry);
  if (entry.metadata) {
    data.metadata = entry.metadata;
  }

  return {
    id: entry.id,
    session_id: sessionId,
    request_id: entry.requestId,
    kind: entry.kind,
    timestamp: entry.timestamp,
    sequence,
    data: JSON.stringify(data),
  };
}

export interface AgentConversationEntryDecodeIssue {
  entryId: string;
  requestId: string;
  kind: string;
  name: "transcript_parse_failed";
  issueCount: number;
  issues: string[];
}

export type AgentConversationEntryDecodeIssueSink = (issue: AgentConversationEntryDecodeIssue) => void;

export function rowToEntry(
  row: EntryRow,
  onDecodeIssue?: AgentConversationEntryDecodeIssueSink,
): AgentConversationEntry | undefined {
  let data: {
    content?: string;
    attachments?: unknown;
    xml?: string;
    metadata?: unknown;
  };
  try {
    data = parseJsonText(row.data, "Conversation entry data") as typeof data;
  } catch (error) {
    onDecodeIssue?.({
      entryId: row.id,
      requestId: row.request_id,
      kind: row.kind,
      name: "transcript_parse_failed",
      issueCount: 1,
      issues: [errorMessage(error)],
    });
    return undefined;
  }
  const base = {
    id: row.id,
    requestId: row.request_id,
    timestamp: row.timestamp,
  };
  const metadata = parseEntryMetadata(data.metadata);

  switch (row.kind) {
    case AgentConversationEntryKinds.UserMessage:
      return {
        ...base,
        kind: AgentConversationEntryKinds.UserMessage,
        content: data.content ?? "",
        attachments: parseUploadAttachments(data.attachments),
        metadata,
      };
    case AgentConversationEntryKinds.AssistantDecision:
      return {
        ...base,
        kind: AgentConversationEntryKinds.AssistantDecision,
        xml: data.xml ?? "",
        metadata,
      };
    default:
      return undefined;
  }
}

function encodeEntryData(entry: AgentConversationEntry): Record<string, unknown> {
  switch (entry.kind) {
    case AgentConversationEntryKinds.UserMessage:
      return {
        content: entry.content,
        ...(entry.attachments && entry.attachments.length > 0 ? { attachments: entry.attachments } : {}),
      };
    case AgentConversationEntryKinds.AssistantDecision:
      return { xml: entry.xml };
  }
}

function parseEntryMetadata(value: unknown): AgentConversationEntryMetadata | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AgentConversationEntryMetadata)
    : undefined;
}

function parseUploadAttachments(value: unknown): AgentUploadAttachment[] | undefined {
  const parsed = AgentUploadAttachmentListSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}
