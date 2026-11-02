import { AgentBaseError } from "../Core/AgentBaseError.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import {
  createAgentToolContractDelivery,
  type AgentToolContractReceipt,
} from "../ToolSearch/AgentToolContractDelivery.js";
import { AgentToolPreparationProtocol } from "../ToolSearch/AgentToolMetaToolProtocol.js";
import type { AgentToolContractValidationIssue } from "../ToolRuntime/AgentToolSignatureArgumentValidator.js";
import { createAgentPiToolObservation } from "./AgentPiToolObservation.js";

/** Pi's preflight hook transports structured, nonexecuting preparation through its reason field. */
export class AgentPiToolContractPreparationError extends AgentBaseError {
  readonly receipts: readonly AgentToolContractReceipt[];

  constructor(
    tool: RegisteredTool,
    targets: readonly ToolExecutionTarget[],
    reason: "needs_contract" | "invalid_arguments",
    issues: readonly AgentToolContractValidationIssue[],
  ) {
    const delivery = createAgentToolContractDelivery(tool, targets);
    super(
      JSON.stringify(
        createAgentPiToolObservation({
          status: "failure",
          execution_status: "not_started",
          output_availability: "none",
          compression_method: "verbatim",
          error: {
            code: "pi_tool_call_rejected",
            kind: "invalid_request",
            source: "pi",
            retryable: true,
            message: agentErrorMessage(
              reason === "invalid_arguments" ? "tool.contractArgumentsInvalid" : "tool.contractPreparationRequired",
              { toolName: tool.name },
            ),
          },
          detail: {
            evidence: [],
            result: {
              type: AgentToolPreparationProtocol.type,
              reason,
              contract: delivery.description,
              ...(issues.length
                ? {
                    issues: issues.map(({ pointer, keyword, message }) => ({ path: pointer, keyword, message })),
                  }
                : {}),
            },
          },
        }),
      ),
    );
    this.receipts = [delivery.receipt];
  }
}
