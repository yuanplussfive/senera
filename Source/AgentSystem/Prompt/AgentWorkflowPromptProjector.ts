import type { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import type { AgentWorldSnapshotProvider } from "../World/AgentWorldTypes.js";
import { projectAgentWorldPromptContext } from "../World/AgentWorldPromptContext.js";
import { EmptyAgentWorkflowPromptContext, type AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";

export interface AgentWorkflowPromptProjectorOptions {
  readonly executionLedger?: AgentExecutionLedgerService;
  readonly todos?: AgentTodoService;
  readonly worldRuntime?: AgentWorldSnapshotProvider;
}

/** Projects volatile planning and execution ledgers without routing them through memory. */
export class AgentWorkflowPromptProjector {
  constructor(private readonly options: AgentWorkflowPromptProjectorOptions) {}

  promptContext(sessionId?: string): AgentWorkflowPromptContext {
    return {
      execution: this.options.executionLedger?.promptContext(sessionId) ?? EmptyAgentWorkflowPromptContext.execution,
      todos: this.options.todos?.promptContext(sessionId) ?? EmptyAgentWorkflowPromptContext.todos,
      world: this.options.worldRuntime ? projectAgentWorldPromptContext(this.options.worldRuntime) : null,
    };
  }
}
