import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import {
  AgentPiCompactionSummaryFormatter,
  type AgentPiCompactionSummaryFormattedText,
  type AgentPiCompactionSummaryFormatterOptions,
} from "./AgentPiCompactionSummaryFormatter.js";
import type { AgentPiCompactionToolCallIndex } from "./AgentPiCompactionToolIndex.js";

export const AgentPiCompactionSummaryBridgeProtocol = defineSeneraProtocol("compaction_summary_bridge", 1);
export { AgentPiCompactionSummaryBridgeCustomType } from "../PiShared/AgentPiCompactionPrompt.js";
import { AgentPiCompactionSummaryBridgeCustomType } from "../PiShared/AgentPiCompactionPrompt.js";

export interface AgentPiCompactionSummaryBridgeOptions {
  readonly formatterOptions: AgentPiCompactionSummaryFormatterOptions;
}

export interface AgentPiCompactionSummaryBridgeTransformInput {
  readonly messages: readonly AgentMessage[];
  readonly toolCallIndex?: AgentPiCompactionToolCallIndex;
}

export interface AgentPiCompactionSummaryBridgeResult {
  readonly messages: AgentMessage[];
  readonly conversationSummaryText: string | undefined;
  readonly formattedSummary: AgentPiCompactionSummaryFormattedText | undefined;
  readonly hadCompactionSummary: boolean;
}

export class AgentPiCompactionSummaryBridge {
  private readonly formatter: AgentPiCompactionSummaryFormatter;

  constructor(options: AgentPiCompactionSummaryBridgeOptions) {
    this.formatter = new AgentPiCompactionSummaryFormatter(options.formatterOptions);
  }

  transform(input: AgentPiCompactionSummaryBridgeTransformInput): AgentPiCompactionSummaryBridgeResult {
    const summaryMessage = findCompactionSummaryMessage(input.messages);
    if (!summaryMessage) {
      return {
        messages: [...input.messages],
        conversationSummaryText: undefined,
        formattedSummary: undefined,
        hadCompactionSummary: false,
      };
    }

    const summaryText = summaryMessage.summary.trim();
    const formatted = this.formatter.format({
      summaryText,
      toolCallIndex: input.toolCallIndex,
    });

    if (formatted.text.length === 0) {
      return {
        messages: input.messages.filter((message) => !isCompactionSummaryMessage(message)),
        conversationSummaryText: undefined,
        formattedSummary: undefined,
        hadCompactionSummary: true,
      };
    }

    const replacementMessage = createCompactionSummaryTextMessage(formatted.text, summaryMessage.timestamp);
    const messages = input.messages.map((message) =>
      isCompactionSummaryMessage(message) ? replacementMessage : message,
    );

    return {
      messages,
      conversationSummaryText: formatted.text,
      formattedSummary: formatted,
      hadCompactionSummary: true,
    };
  }
}

interface CompactionSummaryLikeMessage {
  readonly role: "compactionSummary";
  readonly summary: string;
  readonly tokensBefore: number;
  readonly timestamp: number;
}

function findCompactionSummaryMessage(messages: readonly AgentMessage[]): CompactionSummaryLikeMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate?.role === "compactionSummary") return candidate;
  }
  return undefined;
}

function isCompactionSummaryMessage(message: AgentMessage): boolean {
  return message.role === "compactionSummary";
}

function createCompactionSummaryTextMessage(
  text: string,
  timestamp: number,
): Extract<AgentMessage, { role: "custom" }> {
  return {
    role: "custom",
    customType: AgentPiCompactionSummaryBridgeCustomType,
    content: text,
    display: false,
    timestamp,
  };
}
