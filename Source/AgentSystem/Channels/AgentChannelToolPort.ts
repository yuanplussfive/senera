import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentChannelMedia, AgentChannelTimelinePage } from "./AgentChannelTypes.js";
import type {
  AgentChannelHistoryPage,
  AgentChannelWaitConditions,
  AgentChannelWaitRegistration,
  AgentChannelInboxReview,
  AgentChannelSendReceipt,
  AgentChannelMessageBatchReceipt,
} from "./AgentChannelParticipation.js";

export interface AgentChannelToolContext {
  readonly taskId?: string;
  readonly requestId?: string;
  readonly batchId?: string;
  readonly toolCallId?: string;
  readonly sessionId: string;
  readonly interaction?: AgentInteractionContext;
  readonly signal?: AbortSignal;
}

/**
 * Host port for explicit channel actions. Adapters own native protocol capabilities;
 * the shared service owns lane authorization, inbox receipts and durable waits.
 */
export interface AgentChannelToolPort {
  updateConversation(
    input: AgentChannelToolContext & import("./AgentChannelConversation.js").AgentChannelConversationUpdate,
  ): Promise<import("./AgentChannelConversation.js").AgentChannelConversationState>;
  send(
    input: AgentChannelToolContext & {
      readonly messages: readonly string[];
      readonly mentionIds?: readonly string[];
      readonly reply?: boolean;
      readonly messageId?: string;
      readonly allowUnread?: boolean;
    },
  ): Promise<AgentChannelMessageBatchReceipt>;
  sendMedia(
    input: AgentChannelToolContext & {
      readonly resource: string;
      readonly kind: AgentChannelMedia["kind"];
      readonly fileName?: string;
      readonly messageId?: string;
      readonly allowUnread?: boolean;
    },
  ): Promise<AgentChannelSendReceipt>;
  poke(
    input: AgentChannelToolContext & {
      readonly targetId?: string;
      readonly allowUnread?: boolean;
    },
  ): Promise<{ readonly status: "sent" } | AgentChannelInboxReview>;
  recall(
    input: AgentChannelToolContext & {
      readonly messageId: string;
    },
  ): Promise<void>;
  readHistory(
    input: AgentChannelToolContext & {
      readonly limit?: number;
      readonly afterSequence?: number;
    },
  ): Promise<AgentChannelHistoryPage>;
  readArchive(
    input: AgentChannelToolContext & {
      readonly limit?: number;
      readonly before?: number;
    },
  ): Promise<AgentChannelTimelinePage>;
  waitForMessage(
    input: AgentChannelToolContext & {
      readonly conditions: AgentChannelWaitConditions;
      readonly signal?: AbortSignal;
    },
  ): Promise<AgentChannelWaitRegistration | AgentChannelInboxReview>;
}

/** Late-bound bridge used while ServerRuntime assembles channel and model runtimes. */
export class AgentChannelToolGateway implements AgentChannelToolPort {
  constructor(private readonly resolve: () => AgentChannelToolPort | undefined) {}

  updateConversation(input: Parameters<AgentChannelToolPort["updateConversation"]>[0]) {
    return this.port().updateConversation(input);
  }

  send(input: Parameters<AgentChannelToolPort["send"]>[0]) {
    return this.port().send(input);
  }

  sendMedia(input: Parameters<AgentChannelToolPort["sendMedia"]>[0]) {
    return this.port().sendMedia(input);
  }

  poke(input: Parameters<AgentChannelToolPort["poke"]>[0]) {
    return this.port().poke(input);
  }

  recall(input: Parameters<AgentChannelToolPort["recall"]>[0]) {
    return this.port().recall(input);
  }

  readHistory(input: Parameters<AgentChannelToolPort["readHistory"]>[0]) {
    return this.port().readHistory(input);
  }

  readArchive(input: Parameters<AgentChannelToolPort["readArchive"]>[0]) {
    return this.port().readArchive(input);
  }

  waitForMessage(input: Parameters<AgentChannelToolPort["waitForMessage"]>[0]) {
    return this.port().waitForMessage(input);
  }

  private port(): AgentChannelToolPort {
    const port = this.resolve();
    if (!port) throw new Error("The channel service is not ready.");
    return port;
  }
}
