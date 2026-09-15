import type { AgentExecutionPromptContext } from "../Goals/AgentExecutionLedgerTypes.js";
import type { AgentTodoPromptContext } from "../Todos/AgentTodoTypes.js";
import type { AgentWorldPromptContextValue } from "../World/AgentWorldPromptContext.js";
import {
  EmptyAgentDelegationPromptContext,
  type AgentDelegationPromptContext,
} from "../Orchestration/AgentDelegationPromptContext.js";

/** Volatile execution state for the current session. It is not long-term memory. */
export interface AgentWorkflowPromptContext {
  readonly execution: AgentExecutionPromptContext;
  readonly todos: AgentTodoPromptContext;
  readonly world: AgentWorldPromptContextValue;
  /** Lightweight child-run ownership state for the current supervisor session. */
  readonly delegation: AgentDelegationPromptContext;
}

export const EmptyAgentWorkflowPromptContext: AgentWorkflowPromptContext = {
  execution: { active: null, executions: [] },
  todos: {
    items: [],
    counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
  },
  world: null,
  delegation: EmptyAgentDelegationPromptContext,
};
