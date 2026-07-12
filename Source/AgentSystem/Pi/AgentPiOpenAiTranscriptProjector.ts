import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { AgentConversationEntryKinds } from "../Conversation/AgentConversation.js";
import type { AgentOpenAiTranscriptMessage } from "../Conversation/AgentOpenAiTranscript.js";
import type { AgentPiModelProjection } from "./AgentPiTypes.js";

export interface AgentPiOpenAiTranscriptProjection {
  history: AgentMessage[];
  input: string;
}

interface ConversationTurn {
  requestId: string;
  users: Array<Extract<AgentConversationEntry, { kind: "user.message" }>>;
  transcripts: Array<Extract<AgentConversationEntry, { kind: "openai.transcript" }>>;
}

const EmptyUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export class AgentPiOpenAiTranscriptProjector {
  project(input: {
    requestId: string;
    userInput: string;
    conversationEntries: readonly AgentConversationEntry[];
    model: AgentPiModelProjection;
  }): AgentPiOpenAiTranscriptProjection {
    const messages = this.materializeMessages(input.conversationEntries, input.requestId);
    const current = this.currentUserContent(input.conversationEntries, input.requestId) ?? input.userInput;
    return {
      history: this.projectHistory(messages, input.model),
      input: current,
    };
  }

  private materializeMessages(
    entries: readonly AgentConversationEntry[],
    currentRequestId: string,
  ): AgentOpenAiTranscriptMessage[] {
    return this.groupTurns(entries).flatMap((turn) =>
      turn.requestId === currentRequestId ? [] : this.materializeHistoricalTurn(turn),
    );
  }

  private materializeHistoricalTurn(turn: ConversationTurn): AgentOpenAiTranscriptMessage[] {
    const transcript = turn.transcripts.at(-1);
    if (transcript) {
      return transcript.messages;
    }

    const user = turn.users.at(0);
    return user
      ? [
          {
            role: "user",
            content: projectUserContent(user),
          },
        ]
      : [];
  }

  private projectHistory(
    messages: readonly AgentOpenAiTranscriptMessage[],
    model: AgentPiModelProjection,
  ): AgentMessage[] {
    const toolNamesByCallId = new Map<string, string>();
    const projected: AgentMessage[] = [];

    for (const message of messages) {
      if (message.role === "assistant") {
        for (const call of message.tool_calls ?? []) {
          toolNamesByCallId.set(call.id, call.function.name);
        }
      }
      const entry = projectOpenAiMessageToPi(message, model, toolNamesByCallId);
      if (entry) {
        projected.push(entry);
      }
    }

    return projected;
  }

  private currentUserContent(entries: readonly AgentConversationEntry[], requestId: string): string | undefined {
    const current = entries
      .filter(
        (entry): entry is Extract<AgentConversationEntry, { kind: "user.message" }> =>
          entry.kind === AgentConversationEntryKinds.UserMessage && entry.requestId === requestId,
      )
      .at(-1);
    return current ? projectUserContent(current) : undefined;
  }

  private groupTurns(entries: readonly AgentConversationEntry[]): ConversationTurn[] {
    const byRequest = new Map<string, ConversationTurn>();
    const turns: ConversationTurn[] = [];

    for (const entry of entries) {
      let turn = byRequest.get(entry.requestId);
      if (!turn) {
        turn = {
          requestId: entry.requestId,
          users: [],
          transcripts: [],
        };
        byRequest.set(entry.requestId, turn);
        turns.push(turn);
      }

      if (entry.kind === AgentConversationEntryKinds.UserMessage) {
        turn.users.push(entry);
      } else if (entry.kind === AgentConversationEntryKinds.OpenAiTranscript) {
        turn.transcripts.push(entry);
      }
    }

    return turns;
  }
}

function projectOpenAiMessageToPi(
  message: AgentOpenAiTranscriptMessage,
  model: AgentPiModelProjection,
  toolNamesByCallId: ReadonlyMap<string, string>,
): Message | undefined {
  if (message.role === "system" || message.role === "developer") {
    return undefined;
  }
  if (message.role === "user") {
    return {
      role: "user",
      content: [{ type: "text", text: message.content }],
      timestamp: Date.now(),
    };
  }
  if (message.role === "tool") {
    return {
      role: "toolResult",
      toolCallId: message.tool_call_id,
      toolName: toolNamesByCallId.get(message.tool_call_id) ?? "unknown_tool",
      content: [{ type: "text", text: message.content }],
      isError: readToolMessageIsError(message.content),
      timestamp: Date.now(),
    } satisfies ToolResultMessage;
  }

  if (message.role !== "assistant") {
    return undefined;
  }

  const toolCalls = message.tool_calls ?? [];
  return {
    role: "assistant",
    content: [
      ...(message.content
        ? [
            {
              type: "text" as const,
              text: message.content,
            },
          ]
        : []),
      ...toolCalls.map((call) => ({
        type: "toolCall" as const,
        id: call.id,
        name: call.function.name,
        arguments: parseToolArguments(call.function.arguments),
      })),
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...EmptyUsage, cost: { ...EmptyUsage.cost } },
    stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
    timestamp: Date.now(),
  } satisfies AssistantMessage;
}

function projectUserContent(entry: Extract<AgentConversationEntry, { kind: "user.message" }>): string {
  if (!entry.attachments || entry.attachments.length === 0) {
    return entry.content;
  }
  return JSON.stringify(
    {
      content: entry.content,
      attachments: entry.attachments,
    },
    null,
    2,
  );
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function readToolMessageIsError(content: string): boolean {
  try {
    const parsed = readRecord(JSON.parse(content) as unknown);
    return parsed?.status === "failure" || parsed?.is_error === true;
  } catch {
    return false;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
