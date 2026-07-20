import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentToolExecutionReporter } from "./AgentToolExecutionReporter.js";
import { resolveAgentToolRuntimeCapabilities } from "./AgentToolRuntimeCapabilities.js";

export interface AgentHostToolContext {
  tool: RegisteredTool;
  config: AgentSystemConfig;
  configPath?: string;
  workspaceRoot: string;
  registry: AgentPluginRegistryLike;
  executionEnv: SeneraExecutionEnv;
  sessionId?: string;
  requestId?: string;
  step?: number;
  toolCallId?: string;
  batchId?: string;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  signal?: AbortSignal;
  reporter?: AgentToolExecutionReporter;
}

export interface AgentHostToolReportingScope {
  reporter: AgentToolExecutionReporter;
  close(): Promise<void>;
}

export function openAgentHostToolReportingScope(context: AgentHostToolContext): AgentHostToolReportingScope {
  if (context.reporter) {
    return { reporter: context.reporter, close: () => Promise.resolve() };
  }

  const reporter = new AgentToolExecutionReporter({
    toolName: context.tool.name,
    callId: context.toolCallId,
    requestId: context.requestId,
    step: context.step,
    batchId: context.batchId,
    onEvent: context.onEvent,
    capabilities: resolveAgentToolRuntimeCapabilities(context.tool),
  });
  return { reporter, close: () => reporter.flush() };
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
