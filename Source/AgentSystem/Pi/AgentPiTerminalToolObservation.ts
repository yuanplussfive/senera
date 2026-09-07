import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentPiToolResultStatuses } from "./AgentPiTypes.js";
import { readAgentPiToolObservation } from "./AgentPiToolObservation.js";
import { AgentToolObservationContextCompiler } from "../ToolRuntime/AgentToolObservationContextCompiler.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
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

/** Converts Pi-owned pre-execution failures into the same bounded protocol as executed Senera tools. */
export class AgentPiTerminalToolObservationProjector {
  private readonly compiler: AgentToolObservationContextCompiler;
  private readonly replacements = new Map<string, string>();

  constructor(model: string) {
    this.compiler = new AgentToolObservationContextCompiler({ model });
  }

  settle(turnState: AgentPiTurnState | undefined, event: AgentPiTerminalToolEvent): void {
    if (!turnState) return;
    const existing = readAgentPiToolObservation(readTextContent(event.result));
    if (!event.isError || existing) {
      turnState.settleToolObservationBudget(event.toolCallId, event.result);
      return;
    }

    const errorMessage = readTextContent(event.result) || agentErrorMessage("pi.toolCallRejectedBeforeExecution");
    const tokenLimit = turnState.toolObservationBudgetLimit(
      event.toolCallId,
      StandardAgentToolObservationProjection.maxTokens,
    );
    const observation = this.compiler.compile(
      {
        toolName: event.toolName,
        callId: event.toolCallId,
        batchId: turnState.toolBatchId(event.toolCallId),
        status: AgentPiToolResultStatuses.Failure,
        executionStatus: AgentToolExecutionStatuses.NotStarted,
        outputAvailability: AgentToolOutputAvailabilities.None,
        summary: agentErrorMessage("pi.toolCallRejectedBeforeExecution"),
        error: {
          code: "pi_tool_call_rejected",
          kind: "invalid_request",
          source: "pi",
          retryable: true,
          message: errorMessage,
        },
        outcome: undefined,
        process: undefined,
        result: undefined,
        arguments: undefined,
        artifact: undefined,
      },
      StandardAgentToolObservationProjection,
      tokenLimit,
    );
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
