import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Usage } from "@earendil-works/pi-ai";
import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { authoritativeConversationSequence } from "../Conversation/AgentConversationSequence.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { projectAgentPiImageAttachments } from "./AgentPiImageAttachmentProjector.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentPiModelProjection } from "./AgentPiTypes.js";

export interface AgentPiConversationProjection {
  history: AgentMessage[];
  input: string;
}

export interface AgentPiMultimodalConversationProjection extends AgentPiConversationProjection {
  images: ImageContent[];
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

export class AgentPiConversationProjector {
  constructor(private readonly conversationPolicy = new AgentConversationPolicy()) {}

  project(input: {
    requestId: string;
    userInput: string;
    conversationEntries: readonly AgentConversationEntry[];
    model: AgentPiModelProjection;
  }): AgentPiConversationProjection {
    const sequence = authoritativeConversationSequence(input.conversationEntries);
    const currentUser = sequence.find(
      (entry): entry is Extract<AgentConversationEntry, { kind: "user.message" }> =>
        entry.kind === AgentConversationEntryKinds.UserMessage && entry.requestId === input.requestId,
    );
    return {
      history: sequence
        .filter((entry) => entry.requestId !== input.requestId)
        .map((entry) => this.projectHistoricalEntry(entry, input.model)),
      input: currentUser ? this.conversationPolicy.renderCurrentUserMessage(currentUser) : input.userInput,
    };
  }

  async projectWithImages(input: {
    requestId: string;
    userInput: string;
    conversationEntries: readonly AgentConversationEntry[];
    model: AgentPiModelProjection;
    currentAttachments?: readonly AgentUploadAttachment[];
    uploadStore?: Pick<AgentUploadStore, "resolve">;
    signal?: AbortSignal;
  }): Promise<AgentPiMultimodalConversationProjection> {
    const sequence = authoritativeConversationSequence(input.conversationEntries);
    const currentUser = sequence.find(
      (entry): entry is Extract<AgentConversationEntry, { kind: "user.message" }> =>
        entry.kind === AgentConversationEntryKinds.UserMessage && entry.requestId === input.requestId,
    );
    const historicalEntries = sequence.filter((entry) => entry.requestId !== input.requestId);
    const [history, images] = await Promise.all([
      Promise.all(
        historicalEntries.map(async (entry) => {
          const projected = this.projectHistoricalEntry(entry, input.model);
          if (entry.kind !== AgentConversationEntryKinds.UserMessage) return projected;

          const historicalImages = await projectAgentPiImageAttachments({
            attachments: entry.attachments,
            model: input.model,
            uploadStore: input.uploadStore,
            signal: input.signal,
          });
          if (historicalImages.length === 0 || projected.role !== "user" || !Array.isArray(projected.content)) {
            return projected;
          }
          return {
            ...projected,
            content: [...projected.content, ...historicalImages],
          };
        }),
      ),
      projectAgentPiImageAttachments({
        attachments: input.currentAttachments ?? currentUser?.attachments,
        model: input.model,
        uploadStore: input.uploadStore,
        signal: input.signal,
      }),
    ]);

    return {
      history,
      input: currentUser ? this.conversationPolicy.renderCurrentUserMessage(currentUser) : input.userInput,
      images,
    };
  }

  private projectHistoricalEntry(entry: AgentConversationEntry, model: AgentPiModelProjection): AgentMessage {
    return entry.kind === AgentConversationEntryKinds.UserMessage
      ? {
          role: "user",
          content: [{ type: "text", text: this.conversationPolicy.renderHistoricalUserMessage(entry) }],
          timestamp: parseTimestamp(entry.timestamp),
        }
      : projectAssistantMessage(entry, model);
  }
}

function projectAssistantMessage(
  entry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>,
  model: AgentPiModelProjection,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: entry.xml }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...EmptyUsage, cost: { ...EmptyUsage.cost } },
    stopReason: "stop",
    timestamp: parseTimestamp(entry.timestamp),
  };
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
