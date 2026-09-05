import type { AgentExecutionPromptContext } from "../Goals/AgentExecutionLedgerTypes.js";
import type { AgentTodoPromptContext } from "../Todos/AgentTodoTypes.js";
import type { AgentWorldPromptContextValue } from "../World/AgentWorldPromptContext.js";

/** Volatile execution state for the current session. It is not long-term memory. */
export interface AgentWorkflowPromptContext {
  readonly execution: AgentExecutionPromptContext;
  readonly todos: AgentTodoPromptContext;
  readonly world: AgentWorldPromptContextValue;
}

export const EmptyAgentWorkflowPromptContext: AgentWorkflowPromptContext = {
  execution: { active: null, executions: [] },
  todos: {
    items: [],
    counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
  },
  world: null,
};
