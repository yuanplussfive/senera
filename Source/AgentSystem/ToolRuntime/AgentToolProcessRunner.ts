import { spawn } from "node:child_process";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolProcessRequest } from "../Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import { AgentToolProcessEntryResolver } from "./AgentToolProcessEntryResolver.js";
import { buildAgentPluginProcessExecutionPlan } from "./AgentPluginProcessExecutionProfile.js";
import { createToolProcessRequestEnvelope } from "./AgentToolProcessRequestEnvelope.js";
import { AgentToolProcessResponseParser } from "./AgentToolProcessResponseParser.js";
import { AgentToolProcessSession } from "./AgentToolProcessSession.js";
import type { AgentToolProcessRunResult, AgentToolProcessSpawner } from "./AgentToolProcessTypes.js";
import { bindAgentToolFallbackContext, type AgentToolExecutionCorrelation } from "./AgentToolFallbackContext.js";

export type {
  AgentToolProcessChild,
  AgentToolProcessRunResult,
  AgentToolProcessSpawner,
  AgentToolProcessSpawnOptions,
} from "./AgentToolProcessTypes.js";

export class AgentToolProcessRunner {
  private readonly entryResolver: AgentToolProcessEntryResolver;
  private readonly responseParser = new AgentToolProcessResponseParser();

  constructor(
    private readonly config: AgentSystemConfig,
    _protocol: AgentXmlProtocolSpec,
    private readonly workspaceRoot: string = process.cwd(),
    private readonly spawnProcess: AgentToolProcessSpawner = spawn as AgentToolProcessSpawner,
  ) {
    this.entryResolver = new AgentToolProcessEntryResolver(workspaceRoot);
  }

  async run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolExecutionCorrelation & { signal?: AbortSignal } = {},
  ): Promise<AgentToolProcessRunResult> {
    const entry = this.entryResolver.resolve(tool);
    if (!entry.ok) {
      return entry.result;
    }

    const toolExecution = resolveToolExecutionConfig(this.config);
    const executionPlan = buildAgentPluginProcessExecutionPlan({
      workspaceRoot: this.workspaceRoot,
      tool,
    });
    const request: AgentToolProcessRequest = {
      tool: tool.name,
      arguments: args,
      context: executionPlan.guestContext,
    };

    return new AgentToolProcessSession({
      spawnProcess: this.spawnProcess,
      responseParser: this.responseParser,
      toolName: tool.name,
      command: entry.command,
      args: entry.args,
      cwd: entry.cwd,
      env: entry.entry.Env,
      requestPayload: this.renderRequestPayload(request),
      timeoutMs: toolExecution.TimeoutMs,
      maxStdoutBytes: toolExecution.MaxStdoutBytes,
      maxStderrBytes: toolExecution.MaxStderrBytes,
      signal: context.signal,
      executionProfile: bindAgentToolFallbackContext({
        profile: executionPlan.profile,
        tool,
        correlation: context,
      }),
    }).run();
  }

  private renderRequestPayload(request: AgentToolProcessRequest): string {
    return `${JSON.stringify(createToolProcessRequestEnvelope(request))}\n`;
  }
}
