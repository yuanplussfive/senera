import type {
  ActionPlannedData,
  ActionPlannerStageCompletedData,
  ActionPlannerStageName,
  InteractionRoutedData,
  InteractionRunMode,
  ToolCallsPlannedData,
} from "../../api/eventTypes";
import type { RunRecord } from "./types";

export function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 把后端行动/决策枚举翻译成中文用户语。 */
export function friendlyDecisionKind(decisionKind: string): string {
  switch (decisionKind) {
    case "direct_response":
      return "直接回复";
    case "tool_agent_loop":
      return "执行任务";
    case "answer":
    case "FinalAnswer":
      return "生成回复";
    case "ask_user":
    case "AskUser":
      return "向用户提问";
    case "discover_tools":
      return "发现工具";
    case "use_tools":
    case "ToolCalls":
      return "调用工具";
    default:
      return decisionKind;
  }
}

export function summarizeActionPlan(data: ActionPlannedData): string {
  if (data.status === "fallback") {
    return data.reason
      ? `规划失败，已回退动态工具检索 · ${friendlyActionPlanFallbackReason(data.reason)}`
      : "规划失败，已回退动态工具检索";
  }

  const question = data.askUserQuestion ? truncate(data.askUserQuestion, 96) : "";
  const instruction = data.instruction ? truncate(data.instruction, 96) : "";
  const toolSummary = data.preferredTools.length > 0
    ? `${data.preferredTools.length} 个候选工具`
    : "";
  const searchSummary = data.toolSearchQueries.length > 0
    ? `${data.toolSearchQueries.length} 个检索意图`
    : "";
  const capabilitySummary = (data.capabilityNeeds?.length ?? 0) > 0
    ? `${data.capabilityNeeds?.length ?? 0} 组能力需求`
    : "";
  const stateSummary = data.runState
    ? `${data.runState.totalToolCalls} 次工具 · ${data.runState.totalEvidence} 条证据`
    : "";
  return [question, instruction, toolSummary, searchSummary, capabilitySummary, stateSummary]
    .filter(Boolean)
    .join(" · ");
}

function friendlyActionPlanFallbackReason(reason: string): string {
  const code = reason.split(":")[0];
  switch (code) {
    case "disabled":
      return "未启用";
    case "action_planner_http_error":
      return "规划模型请求失败";
    case "action_planner_timeout":
      return "规划模型超时";
    case "action_planner_aborted":
      return "规划已取消";
    case "action_planner_incomplete_output":
      return "规划输出不完整";
    case "action_planner_invalid_structured_output":
    case "action_planner_invalid_decision":
      return "规划输出无效";
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
    case "understandUserTurn":
      return "理解当前请求";
  }
}

export const InteractionModeTitle = {
  direct_response: "直接回复",
  tool_agent_loop: "执行任务",
} as const satisfies Record<InteractionRunMode, string>;

export function summarizeInteractionRoute(data: InteractionRoutedData): string {
  const objective = data.objective ? truncate(data.objective, 96) : undefined;
  const reason = data.reason ? truncate(data.reason, 96) : undefined;
  const evidence = data.needsFreshEvidence ? "需要新证据" : undefined;
  const workspace = data.needsWorkspaceRead ? "读取工作区" : undefined;
  const effect = data.needsSideEffect ? "包含真实变更" : undefined;
  const tools = data.preferredTools.length > 0
    ? `${data.preferredTools.length} 个候选技能`
    : undefined;
  const search = data.discoveryQueries.length > 0
    ? `${data.discoveryQueries.length} 个发现意图`
    : undefined;
  return [objective, reason, evidence, workspace, effect, tools, search]
    .filter(Boolean)
    .join(" · ");
}

export function toolPlanTitle(data: ToolCallsPlannedData): string {
  switch (data.status) {
    case "discovery_escalated":
      return "自动发现工具";
    case "blocked":
      return "工具计划受阻";
    default:
      if (data.executionMode === "parallel" && data.toolCount > 1) {
        return `并发工具批次 · ${data.toolCount} 个`;
      }
      if (data.executionMode === "sequential") {
        return `顺序工具调用 · ${data.toolCount} 个`;
      }
      return `工具计划 · ${data.toolCount} 个`;
  }
}

export function summarizeToolPlan(data: ToolCallsPlannedData): string {
  const execution = data.executionMode === "parallel" && data.toolCount > 1
    ? "并发执行"
    : data.executionMode === "sequential"
      ? "顺序执行"
      : undefined;
  return [
    execution,
    data.reason ? truncate(data.reason, 96) : undefined,
    data.tools.length > 0 ? data.tools.join(", ") : undefined,
  ].filter(Boolean).join(" · ");
}

export function readRouteExpectedOutputMode(
  data: InteractionRoutedData,
): RunRecord["expectedOutputMode"] {
  return data.expectedOutputMode === "open" || data.expectedOutputMode === "final_text"
    ? data.expectedOutputMode
    : "unknown";
}

export function plannerStageTitle(
  stage: ActionPlannerStageName,
  _selectedAction?: string,
): string {
  return plannerStageBaseTitle(stage);
}

export function summarizePlannerStage(data: ActionPlannerStageCompletedData): string | undefined {
  if (data.turnUnderstanding) {
    const understanding = data.turnUnderstanding;
    return [
      understanding.standaloneRequest
        ? `改写为：${truncate(understanding.standaloneRequest, 96)}`
        : undefined,
      understanding.contextMode === "Used" && understanding.contextBasis
        ? truncate(understanding.contextBasis, 96)
        : undefined,
      understanding.contextMode === "Insufficient" && understanding.missingContext
        ? `缺少：${truncate(understanding.missingContext, 96)}`
        : undefined,
    ].filter(Boolean).join(" · ");
  }

  return undefined;
}
