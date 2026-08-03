import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { readAgentNonBlankString, readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import {
  AgentPiCompactionSummaryFormatter,
  type AgentPiCompactionSummaryFormattedText,
  type AgentPiCompactionSummaryFormatterOptions,
} from "./AgentPiCompactionSummaryFormatter.js";
import type { AgentPiCompactionToolCallIndex } from "./AgentPiCompactionToolIndex.js";

export const AgentPiCompactionSummaryBridgeProtocol = defineSeneraProtocol("compaction_summary_bridge", 1);
export const AgentPiCompactionSummaryBridgeCustomType = "senera.compaction_summary_text";

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

    const summaryText = readAgentNonBlankString(summaryMessage.summary) ?? "";
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
    if (isCompactionSummaryMessage(candidate)) {
      return extractCompactionSummary(candidate);
    }
  }
  return undefined;
}

function isCompactionSummaryMessage(message: AgentMessage): boolean {
  const record = readAgentUnknownRecord(message);
  return record?.role === "compactionSummary";
}

function extractCompactionSummary(message: AgentMessage): CompactionSummaryLikeMessage | undefined {
  const record = readAgentUnknownRecord(message) as AgentUnknownRecord | undefined;
  if (!record) return undefined;
  const summary = readAgentNonBlankString(record.summary);
  if (!summary) return undefined;
  const tokensBefore = typeof record.tokensBefore === "number" ? record.tokensBefore : 0;
  const timestamp = typeof record.timestamp === "number" ? record.timestamp : Date.now();
  return { role: "compactionSummary", summary, tokensBefore, timestamp };
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
