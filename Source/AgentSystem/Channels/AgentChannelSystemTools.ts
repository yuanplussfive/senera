import type { AgentChannelToolPort } from "./AgentChannelToolPort.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentChannelWakeEvent } from "./AgentChannelParticipation.js";
import {
  defineSystemTool,
  systemToolArguments,
  type AgentSystemToolDefinition,
} from "../SystemTools/AgentSystemToolDefinition.js";

export const AgentChannelToolCapabilities = {
  UpdateConversation: "channel.update_conversation",
  SendMessage: "channel.send_message",
  SendMedia: "channel.send_media",
  Poke: "channel.poke",
  ReplyMessage: "channel.reply_message",
  RecallMessage: "channel.recall_message",
  WaitMessage: "channel.wait_message",
  ReadHistory: "channel.read_history",
  ReadArchive: "channel.read_archive",
} as const;

interface SendMessageArguments extends Record<string, unknown> {
  readonly taskId?: string;
  readonly messages: readonly string[];
  readonly mentionIds?: readonly string[];
  readonly allowUnread?: boolean;
}

interface ReplyMessageArguments extends SendMessageArguments {
  readonly messageId?: string;
}

interface SendMediaArguments extends Record<string, unknown> {
  readonly taskId?: string;
  readonly resource: string;
  readonly kind: "image" | "audio" | "video" | "file";
  readonly fileName?: string;
  readonly messageId?: string;
  readonly allowUnread?: boolean;
}

interface RecallMessageArguments extends Record<string, unknown> {
  readonly messageId: string;
}

interface PokeArguments extends Record<string, unknown> {
  readonly taskId?: string;
  readonly targetId?: string;
  readonly allowUnread?: boolean;
}

interface WaitMessageArguments extends Record<string, unknown> {
  readonly taskId?: string;
  readonly events: readonly AgentChannelWakeEvent[];
  readonly senderIds?: readonly string[];
  readonly wakeAt?: string;
}

interface ReadHistoryArguments extends Record<string, unknown> {
  readonly limit?: number;
  readonly afterSequence?: number;
}

interface ReadArchiveArguments extends Record<string, unknown> {
  readonly limit?: number;
  readonly before?: number;
}

/** Host implementations for the explicit channel tools declared by the channel package. */
export function createAgentChannelSystemTools(channel: AgentChannelToolPort): readonly AgentSystemToolDefinition[] {
  const context = (host: AgentHostToolContext) => {
    if (!host.sessionId) throw new Error("Channel tools require an active session.");
    return {
      sessionId: host.sessionId,
      requestId: host.requestId,
      batchId: host.batchId,
      toolCallId: host.toolCallId,
      interaction: host.interaction,
      signal: host.signal,
    };
  };

  return [
    defineSystemTool({
      capability: AgentChannelToolCapabilities.UpdateConversation,
      async execute(input, host) {
        if ((host.batchToolNames?.length ?? 1) !== 1)
          throw new Error("Update conversation state in its own tool batch.");
        const args = systemToolArguments<
          import("./AgentChannelConversation.js").AgentChannelConversationUpdate & Record<string, unknown>
        >(input);
        return channel.updateConversation({ ...context(host), ...args });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.SendMedia,
      async execute(input, host) {
        const args = systemToolArguments<SendMediaArguments>(input);
        return channel.sendMedia({ ...context(host), ...args });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.Poke,
      async execute(input, host) {
        const args = systemToolArguments<PokeArguments>(input);
        return channel.poke({ ...context(host), ...args });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.SendMessage,
      async execute(input, host) {
        requireSingleMessageBatch(host);
        const args = systemToolArguments<SendMessageArguments>(input);
        return channel.send({ ...context(host), ...args });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.ReplyMessage,
      async execute(input, host) {
        requireSingleMessageBatch(host);
        const args = systemToolArguments<ReplyMessageArguments>(input);
        return channel.send({
          ...context(host),
          messages: args.messages,
          mentionIds: args.mentionIds,
          reply: true,
          taskId: args.taskId,
          messageId: args.messageId,
          allowUnread: args.allowUnread,
        });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.RecallMessage,
      async execute(input, host) {
        const args = systemToolArguments<RecallMessageArguments>(input);
        await channel.recall({ ...context(host), messageId: args.messageId });
        return { recalled: true, messageId: args.messageId };
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.WaitMessage,
      async execute(input, host) {
        const args = systemToolArguments<WaitMessageArguments>(input);
        if ((host.batchToolNames?.length ?? 1) !== 1) {
          throw new Error("Register a channel wait in its own tool batch, after all sends and reads have completed.");
        }
        return channel.waitForMessage({ ...context(host), conditions: args, signal: host.signal });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.ReadHistory,
      async execute(input, host) {
        const args = systemToolArguments<ReadHistoryArguments>(input);
        return channel.readHistory({
          ...context(host),
          limit: args.limit,
          afterSequence: args.afterSequence,
        });
      },
    }),
    defineSystemTool({
      capability: AgentChannelToolCapabilities.ReadArchive,
      async execute(input, host) {
        const args = systemToolArguments<ReadArchiveArguments>(input);
        return channel.readArchive({ ...context(host), limit: args.limit, before: args.before });
      },
    }),
  ];
}

function requireSingleMessageBatch(host: AgentHostToolContext): void {
  if ((host.batchToolNames?.length ?? 1) !== 1) {
    throw new Error(
      "Send channel messages in one messages array in its own tool batch; review the receipt before continuing.",
    );
  }
}
