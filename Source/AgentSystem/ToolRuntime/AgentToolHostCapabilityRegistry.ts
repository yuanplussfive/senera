import type {
  AgentToolProcessRunResult,
} from "./AgentToolProcessRunner.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export interface AgentHostToolContext {
  tool: RegisteredTool;
  config: AgentSystemConfig;
  configPath?: string;
  workspaceRoot: string;
  registry: AgentPluginRegistryLike;
  executionEnv: SeneraExecutionEnv;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  signal?: AbortSignal;
}

export type AgentHostToolHandler = (
  args: Record<string, unknown>,
  context: AgentHostToolContext,
) => Promise<AgentToolProcessRunResult>;

export class AgentToolHostCapabilityRegistry {
  private readonly handlers = new Map<string, AgentHostToolHandler>();

  register(capability: string, handler: AgentHostToolHandler): this {
    if (this.handlers.has(capability)) {
      throw new Error(agentErrorMessage("tool.hostCapabilityDuplicate", { capability }));
    }

    this.handlers.set(capability, handler);
    return this;
  }

  get(capability: string): AgentHostToolHandler | undefined {
    return this.handlers.get(capability);
  }
}
