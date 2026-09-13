import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readAgentPiToolObservation } from "./AgentPiToolObservationProtocol.js";
import { projectAgentPiToolObservationForContext } from "./AgentPiToolObservationProjection.js";
import { renderAgentPromptInputWire } from "../Prompt/AgentPromptContextWireRenderer.js";

export const AgentPiCompactionSummaryBridgeCustomType = "senera.compaction_summary_text";

export interface AgentPiCompactionPromptInput {
  readonly mode: "compact" | "tree";
  readonly messages: readonly AgentMessage[];
  readonly previousSummary?: string;
  readonly customInstructions?: string;
  readonly fileOperations?: unknown;
  readonly artifactIndex: unknown;
  readonly toolCallIndex: unknown;
  /** Compact source/ref ledger used to rebuild context after compaction. */
  readonly continuityLedger?: unknown;
}

export type AgentPiCompactionDirective =
  | { readonly stage: "summarizePiConversation" }
  | {
      readonly stage: "repairPiConversationSummary";
      readonly invalidSummary: string;
      readonly issues: readonly string[];
    };

export function buildAgentPiCompactionPromptWire(
  input: AgentPiCompactionPromptInput,
  directive: AgentPiCompactionDirective,
): string {
  return renderAgentPromptInputWire(
    {
      kind: "pi_compaction",
      context: {
        mode: input.mode,
        previousSummary: input.previousSummary,
        customInstructions: input.customInstructions,
        fileOperations: input.fileOperations,
        messages: input.messages.flatMap(projectMessage),
        artifactIndex: input.artifactIndex,
        toolCallIndex: input.toolCallIndex,
        continuityLedger: input.continuityLedger,
      },
      directive,
    },
    { estimateTokens: (text) => text.length },
  ).text;
}

/** @deprecated The returned value is a versioned prompt wire, not bare JSON. */
export const buildAgentPiCompactionPromptJson = buildAgentPiCompactionPromptWire;

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
  const observation = readAgentPiToolObservation(text);
  return observation ? projectCompactionObservation(observation) : undefined;
}

/**
 * Compaction only needs continuity facts and retrieval coordinates. An
 * incomplete observation already declares that its full payload is in an
 * Artifact, so replaying result/arguments/process here needlessly inflates the
 * summarizer request and duplicates the active model context.
 */
function projectCompactionObservation(
  observation: NonNullable<ReturnType<typeof readAgentPiToolObservation>>,
): unknown {
  return projectAgentPiToolObservationForContext(observation);
}

function projectContent(content: Extract<AgentMessage, { role: "user" | "custom" }>["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", mimeType: part.mimeType, encodedBytes: part.data.length },
  );
}
