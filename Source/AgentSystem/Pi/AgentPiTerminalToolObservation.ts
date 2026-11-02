import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentPiToolResultStatuses } from "./AgentPiTypes.js";
import { readAgentPiToolObservation, unwrapAttributedToolObservation } from "./AgentPiToolObservation.js";
import type { AgentToolResultObservationCompressor } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import { AgentToolExecutionStatuses, AgentToolOutputAvailabilities } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  retainDeliveredToolContractReceipts,
  type AgentToolContractReceipt,
} from "../ToolSearch/AgentToolContractDelivery.js";

interface AgentPiTerminalToolEvent {
  readonly toolCallId: string;
  readonly parentToolCallId?: string;
  readonly toolName: string;
  readonly result: unknown;
  readonly isError: boolean;
}

/** Projects Pi-owned pre-execution failures through the shared observation budget. */
export class AgentPiTerminalToolObservationProjector {
  private readonly replacements = new Map<string, { content: string; receipts: readonly AgentToolContractReceipt[] }>();

  constructor(
    private readonly compressor: AgentToolResultObservationCompressor,
    private readonly tokenBudget: number,
  ) {}

  async settle(turnState: AgentPiTurnState | undefined, event: AgentPiTerminalToolEvent): Promise<void> {
    if (!turnState) return;
    if (event.parentToolCallId || turnState.parentToolCallId(event.toolCallId)) return;
    const resultText = unwrapAttributedToolObservation(readTextContent(event.result));
    const existing = readAgentPiToolObservation(resultText);
    const receipts = turnState.takeToolContractReceipts(event.toolCallId);
    if (!event.isError || (existing && !receipts.length)) {
      turnState.settleToolObservationBudget(event.toolCallId, event.result);
      return;
    }

    const errorMessage =
      existing?.error?.message ?? (resultText || agentErrorMessage("pi.toolCallRejectedBeforeExecution"));
    const observation = await this.compressor.compress({
      requestId: event.toolCallId,
      toolName: event.toolName,
      status: AgentPiToolResultStatuses.Failure,
      executionStatus: AgentToolExecutionStatuses.NotStarted,
      outputAvailability: AgentToolOutputAvailabilities.None,
      arguments: undefined,
      process: undefined,
      outcome: undefined,
      result: existing?.detail.result,
      error: {
        code: "pi_tool_call_rejected",
        kind: "invalid_request",
        source: "pi",
        retryable: true,
        message: errorMessage,
      },
      systemPrompt: turnState.context.systemPrompt,
      currentUserMessage: turnState.context.userMessage,
      observationBudgetTokens: turnState.toolObservationBudgetTokens(event.toolCallId, this.tokenBudget),
    });
    const content = JSON.stringify(observation);
    this.replacements.set(event.toolCallId, {
      content,
      receipts: retainDeliveredToolContractReceipts(receipts, observation.detail.result),
    });
    turnState.settleToolObservationBudget(event.toolCallId, content);
  }

  replaceMessage(message: AgentMessage): AgentMessage | undefined {
    if (message.role !== "toolResult") return undefined;
    const replacement = this.replacements.get(message.toolCallId);
    if (!replacement) return undefined;
    this.replacements.delete(message.toolCallId);
    return {
      ...message,
      content: [{ type: "text", text: replacement.content }],
      details: {
        senera: {
          toolName: message.toolName,
          status: AgentPiToolResultStatuses.Failure,
          executionStatus: AgentToolExecutionStatuses.NotStarted,
          outputAvailability: AgentToolOutputAvailabilities.None,
          ...(replacement.receipts.length ? { toolContractReceipts: [...replacement.receipts] } : {}),
        },
      },
      isError: true,
    };
  }
}

function readTextContent(value: unknown): string {
  const content = readAgentUnknownRecord(value)?.content;
  return Array.isArray(content)
    ? content
        .flatMap((entry) => {
          const item = readAgentUnknownRecord(entry);
          return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
        })
        .join("")
    : "";
}
