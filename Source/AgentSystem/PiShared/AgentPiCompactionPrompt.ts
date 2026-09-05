import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readAgentPiToolObservation } from "./AgentPiToolObservationProtocol.js";

export const AgentPiCompactionSummaryBridgeCustomType = "senera.compaction_summary_text";

export interface AgentPiCompactionPromptInput {
  readonly mode: "compact" | "tree";
  readonly messages: readonly AgentMessage[];
  readonly previousSummary?: string;
  readonly customInstructions?: string;
  readonly fileOperations?: unknown;
  readonly artifactIndex: unknown;
  readonly toolCallIndex: unknown;
}

export type AgentPiCompactionDirective =
  | { readonly stage: "summarizePiConversation" }
  | {
      readonly stage: "repairPiConversationSummary";
      readonly invalidSummary: string;
      readonly issues: readonly string[];
    };

export function buildAgentPiCompactionPromptJson(
  input: AgentPiCompactionPromptInput,
  directive: AgentPiCompactionDirective,
): string {
  return JSON.stringify(
    {
      compactionInput: {
        mode: input.mode,
        previousSummary: input.previousSummary,
        customInstructions: input.customInstructions,
        fileOperations: input.fileOperations,
        messages: input.messages.flatMap(projectMessage),
        artifactIndex: input.artifactIndex,
        toolCallIndex: input.toolCallIndex,
        directive,
      },
    },
    null,
    2,
  );
}

function projectMessage(message: AgentMessage): unknown[] {
  switch (message.role) {
    case "user":
      return [{ role: "user", content: projectContent(message.content) }];
    case "assistant":
      return [
        {
          role: "assistant",
          text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
          toolCalls: message.content.flatMap((part) =>
            part.type === "toolCall" ? [{ id: part.id, name: part.name, arguments: part.arguments }] : [],
          ),
        },
      ];
    case "toolResult":
      return [
        {
          role: "toolResult",
          callId: message.toolCallId,
          toolName: message.toolName,
          observation: parseToolObservation(message),
        },
      ];
    case "compactionSummary":
      return [
        {
          role: "compactionSummary",
          summary: message.summary,
          tokensBefore: message.tokensBefore,
        },
      ];
    case "branchSummary":
      return [{ role: "branchSummary", summary: message.summary, fromId: message.fromId }];
    case "bashExecution":
      return [
        {
          role: "bashExecution",
          command: message.command,
          output: message.output,
          exitCode: message.exitCode,
          cancelled: message.cancelled,
          truncated: message.truncated,
          fullOutputPath: message.fullOutputPath,
        },
      ];
    case "custom":
      return message.customType === AgentPiCompactionSummaryBridgeCustomType
        ? [{ role: "seneraCompactionSummary", content: projectContent(message.content) }]
        : [];
    default:
      return [];
  }
}

function parseToolObservation(message: Extract<AgentMessage, { role: "toolResult" }>): unknown {
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  return readAgentPiToolObservation(text);
}

function projectContent(content: Extract<AgentMessage, { role: "user" | "custom" }>["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", mimeType: part.mimeType, encodedBytes: part.data.length },
  );
}
