import type {
  ActionPlannedData,
  ActionPlannerStageCompletedData,
  ActionPlannerStageName,
  InteractionRoutedData,
  InteractionRunMode,
  ToolCallsPlannedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "./types";

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

export function summarizeActionPlan(data: ActionPlannedData): string {
  if (data.status === "fallback") {
    return data.reason
      ? frontendMessage("workflow.plan.fallbackMessageWithReason", {
          reason: friendlyActionPlanFallbackReason(data.reason),
        })
      : frontendMessage("workflow.plan.fallbackMessage");
  }

  const question = data.askUserQuestion ? truncate(data.askUserQuestion, 96) : "";
  const instruction = data.instruction ? truncate(data.instruction, 96) : "";
  const toolSummary =
    data.preferredTools.length > 0
      ? frontendMessage("workflow.plan.candidateTools", { count: data.preferredTools.length })
      : "";
  const searchSummary =
    data.toolSearchQueries.length > 0
      ? frontendMessage("workflow.plan.searchIntents", { count: data.toolSearchQueries.length })
      : "";
  const capabilitySummary =
    (data.capabilityNeeds?.length ?? 0) > 0
      ? frontendMessage("workflow.plan.capabilityNeeds", { count: data.capabilityNeeds?.length ?? 0 })
      : "";
  const stateSummary = data.runState
    ? [
        frontendMessage("workflow.plan.toolCallCount", { count: data.runState.totalToolCalls }),
        frontendMessage("workflow.plan.evidenceCount", { count: data.runState.totalEvidence }),
      ].join(" · ")
    : "";
  return [question, instruction, toolSummary, searchSummary, capabilitySummary, stateSummary]
    .filter(Boolean)
    .join(" · ");
}

function friendlyActionPlanFallbackReason(reason: string): string {
  const code = reason.split(":")[0];
  switch (code) {
    case "disabled":
      return frontendMessage("workflow.plan.fallbackDisabled");
    case "action_planner_http_error":
      return frontendMessage("workflow.plan.fallbackHttpError");
    case "action_planner_timeout":
      return frontendMessage("workflow.plan.fallbackTimeout");
    case "action_planner_aborted":
      return frontendMessage("workflow.plan.fallbackAborted");
    case "action_planner_incomplete_output":
      return frontendMessage("workflow.plan.fallbackIncomplete");
    case "action_planner_invalid_structured_output":
    case "action_planner_invalid_decision":
      return frontendMessage("workflow.plan.fallbackInvalid");
    default:
      return truncate(reason, 80);
  }
}

export function readExpectedOutputMode(data: ActionPlannedData): RunRecord["expectedOutputMode"] {
  return data.expectedOutputMode === "open" || data.expectedOutputMode === "final_text"
    ? data.expectedOutputMode
    : "unknown";
}

function plannerStageBaseTitle(stage: ActionPlannerStageName): string {
  switch (stage) {
    case "prepareInteraction":
      return frontendMessage("workflow.plan.plannerStageUnderstand");
  }
}

export const InteractionModeTitle = {
  direct_response: "workflow.plan.directResponse",
  tool_agent_loop: "workflow.plan.workerMode",
} as const satisfies Record<InteractionRunMode, Parameters<typeof frontendMessage>[0]>;

export function summarizeInteractionRoute(data: InteractionRoutedData): string {
  const objective = data.objective ? truncate(data.objective, 96) : undefined;
  const tools =
    data.preferredTools.length > 0
      ? frontendMessage("workflow.plan.candidateSkills", { count: data.preferredTools.length })
      : undefined;
  const search =
    data.discoveryQueries.length > 0
      ? frontendMessage("workflow.plan.toolSearchIntents", { count: data.discoveryQueries.length })
      : undefined;
  return [objective, tools, search].filter(Boolean).join(" · ");
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

export function readRouteExpectedOutputMode(data: InteractionRoutedData): RunRecord["expectedOutputMode"] {
  return data.expectedOutputMode === "open" || data.expectedOutputMode === "final_text"
    ? data.expectedOutputMode
    : "unknown";
}

export function plannerStageTitle(stage: ActionPlannerStageName, _selectedAction?: string): string {
  return plannerStageBaseTitle(stage);
}

export function summarizePlannerStage(data: ActionPlannerStageCompletedData): string | undefined {
  if (data.turnUnderstanding) {
    const understanding = data.turnUnderstanding;
    return [
      understanding.standaloneRequest
        ? frontendMessage("workflow.plan.rewrittenRequest", { text: truncate(understanding.standaloneRequest, 96) })
        : undefined,
      understanding.contextMode === "Used" && understanding.contextBasis
        ? truncate(understanding.contextBasis, 96)
        : undefined,
      understanding.contextMode === "Insufficient" && understanding.missingContext
        ? frontendMessage("workflow.plan.missingContext", { text: truncate(understanding.missingContext, 96) })
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return undefined;
}
