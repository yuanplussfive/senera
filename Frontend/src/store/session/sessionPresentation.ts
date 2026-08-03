import type { ToolCallsPlannedData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function friendlyDecisionKind(decisionKind: string): string {
  switch (decisionKind) {
    case "direct_response":
      return frontendMessage("workflow.plan.directResponse");
    case "tool_agent_loop":
      return frontendMessage("workflow.plan.workerMode");
    case "answer":
    case "FinalAnswer":
      return frontendMessage("workflow.projection.assistantFinalAnswer");
    case "ask_user":
    case "AskUser":
      return frontendMessage("workflow.projection.assistantAskUser");
    case "discover_tools":
      return frontendMessage("workflow.plan.discoverTools");
    case "use_tools":
    case "ToolCalls":
      return frontendMessage("workflow.plan.useTools");
    default:
      return decisionKind;
  }
}

export function toolPlanTitle(data: ToolCallsPlannedData): string {
  switch (data.status) {
    case "discovery_escalated":
      return frontendMessage("workflow.plan.autoDiscoverTools");
    case "blocked":
      return frontendMessage("workflow.plan.blocked");
    default:
      if (data.executionMode === "parallel" && data.toolCount > 1) {
        return frontendMessage("workflow.plan.parallelToolBatchShort", { count: data.toolCount });
      }
      if (data.executionMode === "sequential") {
        return frontendMessage("workflow.feed.sequentialToolCalls", { count: data.toolCount });
      }
      return frontendMessage("workflow.plan.toolPlan", { count: data.toolCount });
  }
}

export function summarizeToolPlan(data: ToolCallsPlannedData): string {
  const execution =
    data.executionMode === "parallel" && data.toolCount > 1
      ? frontendMessage("workflow.plan.executionParallel")
      : data.executionMode === "sequential"
        ? frontendMessage("workflow.plan.executionSequential")
        : undefined;
  return [
    execution,
    data.reason ? truncate(data.reason, 96) : undefined,
    data.tools.length > 0 ? data.tools.join(", ") : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
