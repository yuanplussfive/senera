import type { Context } from "@earendil-works/pi-ai";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { isAgentToolExecutable } from "../ToolRuntime/AgentToolAvailability.js";
import {
  AgentToolContractReceiptSchema,
  readDeliveredToolDescriptions,
  retainDeliveredToolContractReceipts,
} from "../ToolSearch/AgentToolContractDelivery.js";
import { projectToolDescription } from "../ToolSearch/AgentToolMetaToolProjector.js";
import { readAgentPiToolObservation, readAgentPiMessageTextContent } from "./AgentPiToolObservation.js";

/** Rebuilds evidence from exact bodies in the active request, including after restart or compaction. */
export function confirmAgentPiDeliveredToolContracts(
  context: Context,
  registry: AgentExtensionRegistry,
  exposure: AgentToolExposureState,
  targets: readonly ToolExecutionTarget[],
): void {
  for (const message of context.messages) {
    if (message.role !== "toolResult") continue;
    const metadata = readAgentUnknownRecord(readAgentUnknownRecord(message.details)?.senera);
    const parsed = AgentToolContractReceiptSchema.array().safeParse(metadata?.toolContractReceipts);
    if (!parsed.success || !parsed.data.length) continue;
    const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
    if (!observation) continue;
    const receipts = retainDeliveredToolContractReceipts(parsed.data, observation.detail.result);
    const descriptions = new Map(
      readDeliveredToolDescriptions(observation.detail.result).map((item) => [item[0], item]),
    );
    for (const receipt of receipts) {
      const tool = registry.getTool(receipt.toolName);
      if (!tool || !isAgentToolExecutable(tool) || tool.contract?.digest !== receipt.contractDigest) continue;
      // The original body must be intact, but its display title is not invocation knowledge.
      // Comparing the spec still detects runtime target changes beyond the static schema digest.
      if (projectToolDescription(tool, targets)[2] === descriptions.get(tool.name)?.[2])
        exposure.confirmContract(tool.name, receipt.contractDigest);
    }
  }
}
