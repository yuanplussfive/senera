import type { ParsedControllerDecision } from "../Interaction/AgentControllerDecision.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";

export function validateAgentPiCompletion(
  decision: ParsedControllerDecision,
  toolPlan: AgentPiToolPlanCoordinator | undefined,
): string[] {
  if (decision.kind !== "Direct" || !toolPlan?.hasUnreconciledCalls()) return [];
  return [agentErrorMessage("pi.directBeforeToolReconciliation")];
}
