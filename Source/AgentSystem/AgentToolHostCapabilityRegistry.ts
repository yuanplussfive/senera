import type {
  AgentToolProcessRunResult,
} from "./AgentToolProcessRunner.js";
import type {
  AgentSystemConfig,
  AgentPluginRegistryLike,
  RegisteredTool,
} from "./Types.js";

export interface AgentHostToolContext {
  tool: RegisteredTool;
  config: AgentSystemConfig;
  workspaceRoot: string;
  registry: AgentPluginRegistryLike;
  requestId?: string;
  step?: number;
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
      throw new Error(`宿主工具能力重复注册：${capability}`);
    }

    this.handlers.set(capability, handler);
    return this;
  }

  get(capability: string): AgentHostToolHandler | undefined {
    return this.handlers.get(capability);
  }
}
