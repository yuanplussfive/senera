import type { AgentToolCallPlannerPromptInput } from "./AgentToolCallPlannerPromptJson.js";
import type { AgentPlannedToolCall } from "./AgentToolCallPlannerSchema.js";
import { issueMessages } from "./AgentActionPlannerFailure.js";
import { uniqueStrings } from "./AgentActionPlannerProjectionUtils.js";
import type { AgentActionCapabilityNeed } from "./AgentActionPlannerTypes.js";

export type AgentToolCallPlanningOutcome =
  | {
      kind: "calls";
      calls: AgentPlannedToolCall[];
      repaired: boolean;
    }
  | {
      kind: "needsDiscovery";
      queries: string[];
      needs: AgentActionCapabilityNeed[];
      reason: string;
      issues: string[];
      repaired: boolean;
    }
  | {
      kind: "blocked";
      reason: string;
      issues: string[];
      repaired: boolean;
    };

export function toolCallDiscoveryPreflight(
  input: AgentToolCallPlannerPromptInput,
): AgentToolCallPlanningOutcome | undefined {
  const missingIssues = [
    input.rootCommand.allowedTools.length === 0
      ? "allowedTools: 当前 RootCommand 没有可调用工具。"
      : undefined,
    input.toolContracts.length === 0
      ? "toolContracts: 当前提示上下文没有可用工具签名。"
      : undefined,
  ].filter((issue): issue is string => Boolean(issue));

  return missingIssues.length === 0
    ? undefined
    : emptyToolCallPlanOutcome(input, {
        repaired: false,
        extraIssues: missingIssues,
      });
}

export function emptyToolCallPlanOutcome(
  input: AgentToolCallPlannerPromptInput,
  options: {
    error?: unknown;
    repaired: boolean;
    extraIssues?: readonly string[];
  },
): AgentToolCallPlanningOutcome {
  const issues = uniqueStrings([
    ...(options.extraIssues ?? []),
    ...(options.error ? issueMessages(options.error) : []),
  ]);

  if (input.rootCommand.action === "discover_tools") {
    return {
      kind: "blocked",
      reason: "工具发现阶段没有生成可执行工具调用。",
      issues,
      repaired: options.repaired,
    };
  }

  return {
    kind: "needsDiscovery",
    queries: discoveryQueriesForEmptyToolPlan(input),
    needs: input.rootCommand.needs,
    reason: "工具调用计划为空，需要先发现可用工具能力。",
    issues,
    repaired: options.repaired,
  };
}

function discoveryQueriesForEmptyToolPlan(input: AgentToolCallPlannerPromptInput): string[] {
  return uniqueStrings([
    ...input.rootCommand.toolSearchQueries,
    ...(input.rootCommand.taskContract?.discoveryQueries ?? []),
    input.rootCommand.instruction ?? "",
    input.rootCommand.taskContract?.nextStepPurpose ?? "",
    input.rootCommand.objective,
    input.actionInput.currentUserTurn.content,
  ]);
}
