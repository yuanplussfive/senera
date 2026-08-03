import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentToolExecutionReporter } from "./AgentToolExecutionReporter.js";
import { resolveAgentToolRuntimeCapabilities } from "./AgentToolRuntimeCapabilities.js";
import type { AgentToolExecutionPlan } from "./AgentToolExecutionPlan.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolExposureState } from "./AgentToolExposureState.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

export interface AgentHostToolContext {
  tool: RegisteredTool;
  config: AgentSystemConfig;
  configPath?: string;
  workspaceRoot: string;
  registry: AgentExtensionRegistryLike;
  executionEnv: SeneraExecutionEnv;
  uploadStore?: Pick<AgentUploadStore, "resolve">;
  sessionId?: string;
  requestId?: string;
  step?: number;
  toolCallId?: string;
  batchId?: string;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  toolExposure?: AgentToolExposureState;
  signal?: AbortSignal;
  executionPlan?: AgentToolExecutionPlan;
  reporter?: AgentToolExecutionReporter;
  resources?: Readonly<Record<string, unknown>>;
  tokenBudget?: AgentToolTokenBudget;
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

export interface AgentHostToolContractProjection {
  projectInvocationSchema?(tool: RegisteredTool, schema: Readonly<Record<string, unknown>>): Record<string, unknown>;
  projectDescription?(tool: RegisteredTool, description: string): string;
}

export class AgentToolHostCapabilityRegistry {
  private readonly handlers = new Map<string, AgentHostToolHandler>();
  private readonly contractProjections = new Map<string, AgentHostToolContractProjection>();

  register(
    capability: string,
    handler: AgentHostToolHandler,
    contractProjection?: AgentHostToolContractProjection,
  ): this {
    if (this.handlers.has(capability)) {
      throw new AgentLocalizedError("tool.hostCapabilityDuplicate", { capability });
    }

    this.handlers.set(capability, handler);
    if (contractProjection) this.contractProjections.set(capability, contractProjection);
    return this;
  }

  get(capability: string): AgentHostToolHandler | undefined {
    return this.handlers.get(capability);
  }

  projectInvocationSchema(tool: RegisteredTool, schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const projection = this.contractProjection(tool)?.projectInvocationSchema;
    return projection ? projection(tool, schema) : (schema as Record<string, unknown>);
  }

  projectDescription(tool: RegisteredTool, description: string): string {
    return this.contractProjection(tool)?.projectDescription?.(tool, description) ?? description;
  }

  private contractProjection(tool: RegisteredTool): AgentHostToolContractProjection | undefined {
    return tool.handler.kind === "HostCapability" ? this.contractProjections.get(tool.handler.capability) : undefined;
  }
}
