import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../Conversation/AgentConversation.js";
import type { AgentConversationEntryMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { parseAgentOpenAiTranscriptMessages } from "../Conversation/AgentOpenAiTranscript.js";
import {
  AgentUploadAttachmentListSchema,
  type AgentUploadAttachment,
} from "../Uploads/AgentUploadTypes.js";
import type { EntryRow } from "./AgentSessionSqlRows.js";
import {
  parsePlannerJournalRecord,
  parseToolEvidenceMemoryRecord,
} from "./AgentPlannerRecordCodec.js";

export interface EncodedEntryRow {
  id: string;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  sequence: number;
  data: string;
}

export function entryToRow(
  sessionId: string,
  entry: AgentConversationEntry,
  sequence: number,
): EncodedEntryRow {
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

export function rowToEntry(row: EntryRow): AgentConversationEntry | undefined {
  const data = JSON.parse(row.data) as {
    content?: string;
    attachments?: unknown;
    messages?: unknown;
    xml?: string;
    record?: unknown;
    metadata?: unknown;
  };
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
    case AgentConversationEntryKinds.OpenAiTranscript:
      return {
        ...base,
        kind: AgentConversationEntryKinds.OpenAiTranscript,
        messages: parseAgentOpenAiTranscriptMessages(data.messages),
        metadata,
      };
    case AgentConversationEntryKinds.ContextToolResults:
      return {
        ...base,
        kind: AgentConversationEntryKinds.ContextToolResults,
        xml: data.xml ?? "",
        metadata,
      };
    case AgentConversationEntryKinds.PlannerJournal:
      return {
        ...base,
        kind: AgentConversationEntryKinds.PlannerJournal,
        record: parsePlannerJournalRecord(data.record, row.request_id, row.timestamp),
        metadata,
      };
    case AgentConversationEntryKinds.ToolEvidenceMemory:
      return {
        ...base,
        kind: AgentConversationEntryKinds.ToolEvidenceMemory,
        record: parseToolEvidenceMemoryRecord(data.record, row.request_id, row.timestamp),
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
        ...(entry.attachments && entry.attachments.length > 0
          ? { attachments: entry.attachments }
          : {}),
      };
    case AgentConversationEntryKinds.OpenAiTranscript:
      return { messages: entry.messages };
    case AgentConversationEntryKinds.AssistantDecision:
    case AgentConversationEntryKinds.ContextToolResults:
      return { xml: entry.xml };
    case AgentConversationEntryKinds.PlannerJournal:
    case AgentConversationEntryKinds.ToolEvidenceMemory:
      return { record: entry.record };
  }
}

function parseEntryMetadata(value: unknown): AgentConversationEntryMetadata | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AgentConversationEntryMetadata
    : undefined;
}

function parseUploadAttachments(value: unknown): AgentUploadAttachment[] | undefined {
  const parsed = AgentUploadAttachmentListSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}
