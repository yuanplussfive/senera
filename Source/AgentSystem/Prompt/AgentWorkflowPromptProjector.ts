import type { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import { EmptyAgentWorkflowPromptContext, type AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
import {
  EmptyAgentDelegationPromptContext,
  type AgentDelegationPromptContext,
} from "../Orchestration/AgentDelegationPromptContext.js";

export interface AgentDelegationPromptSource {
  promptContext(parentSessionId?: string): AgentDelegationPromptContext;
}

export interface AgentWorkflowPromptProjectorOptions {
  readonly executionLedger?: AgentExecutionLedgerService;
  readonly todos?: AgentTodoService;
  readonly delegation?: AgentDelegationPromptSource;
}

/** Projects volatile planning and execution ledgers without routing them through memory. */
export class AgentWorkflowPromptProjector {
  constructor(private readonly options: AgentWorkflowPromptProjectorOptions) {}

  promptContext(sessionId?: string): AgentWorkflowPromptContext {
    return {
      execution: this.options.executionLedger?.promptContext(sessionId) ?? EmptyAgentWorkflowPromptContext.execution,
      todos: this.options.todos?.promptContext(sessionId) ?? EmptyAgentWorkflowPromptContext.todos,
      delegation: this.options.delegation?.promptContext(sessionId) ?? EmptyAgentDelegationPromptContext,
    };
  }
}
