import type { AgentExecutionLedger, AgentExecutionPromptContext } from "../Goals/AgentExecutionLedgerTypes.js";
import type { AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
import { EmptyAgentDelegationPromptContext } from "../Orchestration/AgentDelegationPromptContext.js";

export function normalizeAgentWorkflowTemplateContext(input: AgentWorkflowPromptContext): AgentWorkflowPromptContext {
  return {
    execution: normalizeExecution(input.execution),
    todos: input.todos,
    delegation: input.delegation ?? EmptyAgentDelegationPromptContext,
  };
}

function normalizeExecution(input: AgentExecutionPromptContext): AgentExecutionPromptContext {
  return {
    active: input.active ? normalizeExecutionLedger(input.active) : null,
    executions: input.executions.map(normalizeExecutionLedger),
  };
}

function normalizeExecutionLedger(execution: AgentExecutionLedger): AgentExecutionLedger {
  return {
    ...execution,
    reason: execution.reason ?? "",
    steps: execution.steps.map((step) => ({
      ...step,
      failure: step.failure ?? "",
    })),
  };
}
