import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentPiToolResultStatuses } from "./AgentPiTypes.js";
import { readAgentPiToolObservation } from "./AgentPiToolObservation.js";
import type { AgentToolResultObservationCompressor } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import { AgentToolExecutionStatuses, AgentToolOutputAvailabilities } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

interface AgentPiTerminalToolEvent {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: unknown;
  readonly isError: boolean;
}

/** Projects Pi-owned pre-execution failures through the shared observation budget. */
export class AgentPiTerminalToolObservationProjector {
  private readonly replacements = new Map<string, string>();

  constructor(
    private readonly compressor: AgentToolResultObservationCompressor,
    private readonly tokenBudget: number,
  ) {}

  async settle(turnState: AgentPiTurnState | undefined, event: AgentPiTerminalToolEvent): Promise<void> {
    if (!turnState) return;
    const existing = readAgentPiToolObservation(readTextContent(event.result));
    if (!event.isError || existing) {
      turnState.settleToolObservationBudget(event.toolCallId, event.result);
      return;
    }

    const errorMessage = readTextContent(event.result) || agentErrorMessage("pi.toolCallRejectedBeforeExecution");
    const observation = await this.compressor.compress({
      requestId: event.toolCallId,
      toolName: event.toolName,
      status: AgentPiToolResultStatuses.Failure,
      executionStatus: AgentToolExecutionStatuses.NotStarted,
      outputAvailability: AgentToolOutputAvailabilities.None,
      arguments: undefined,
      process: undefined,
      outcome: undefined,
      result: undefined,
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
    this.replacements.set(event.toolCallId, content);
    turnState.settleToolObservationBudget(event.toolCallId, content);
  }

  replaceMessage(message: AgentMessage): AgentMessage | undefined {
    if (message.role !== "toolResult") return undefined;
    const content = this.replacements.get(message.toolCallId);
    if (!content) return undefined;
    this.replacements.delete(message.toolCallId);
    return {
      ...message,
      content: [{ type: "text", text: content }],
      details: {
        senera: {
          toolName: message.toolName,
          status: AgentPiToolResultStatuses.Failure,
          executionStatus: AgentToolExecutionStatuses.NotStarted,
          outputAvailability: AgentToolOutputAvailabilities.None,
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
