import { createRequestId } from "../Core/AgentIds.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AskUserControlResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { renderOpenAiToolObservationContent } from "../ToolRuntime/AgentToolObservationRenderer.js";
import { redactArtifactSecrets } from "../Artifacts/AgentArtifactRedaction.js";
import { readRecord, stringifyPreview } from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import {
  readPiProxyToolCallBatchId,
  registerPiProxyExecutedToolResult,
} from "../PiProxy/AgentPiProxyRuntimeContext.js";
import type { AgentPiToolExecutionInput, AgentPiToolResult } from "./AgentPiTypes.js";

export interface AgentPiToolExecutionBridgeOptions {
  executeToolCall: AgentToolCallExecutor["execute"];
  recordToolArtifacts: AgentToolExecutionArtifactRecorder["record"];
  model: string;
}

export class AgentPiToolExecutionError extends Error {
  constructor(
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "AgentPiToolExecutionError";
  }
}

export class AgentPiToolExecutionBridge {
  constructor(private readonly options: AgentPiToolExecutionBridgeOptions) {}

  async execute(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const requestId = input.context.requestId ?? createRequestId();
    const step = input.context.step ?? 1;
    const batchId = readPiProxyToolCallBatchId(input.context.piProxyRuntimeContextId, input.toolCallId);
    const execution = await this.options.executeToolCall(
      {
        name: input.tool.name,
        arguments: input.params,
        callId: input.toolCallId,
      },
      {
        sessionId: input.context.sessionId,
        requestId,
        step,
        onEvent: input.context.onEvent,
        loadedToolNames: input.context.visibleToolNames,
        batchId,
        signal: input.signal,
      },
    );

    if (execution.kind === "AskUser") {
      return this.projectAskUser(input.tool.name, execution.value);
    }

    const [recorded] = await this.options.recordToolArtifacts({
      ...(input.context.sessionId ? { sessionId: input.context.sessionId } : {}),
      requestId,
      step,
      results: execution.value,
    });
    const result = recorded ?? execution.value[0];
    if (result) {
      registerPiProxyExecutedToolResult(input.context.piProxyRuntimeContextId, input.toolCallId, result);
    }
    const error = readStructuredToolError(result?.result);
    if (error) {
      throw new AgentPiToolExecutionError(error.message, projectToolFailureDetails(result));
    }

    return this.projectToolResult(input.tool, result);
  }

  private projectAskUser(toolName: string, result: AskUserControlResult): AgentPiToolResult {
    return {
      content: [
        {
          type: "text",
          text: `工具 ${toolName} 需要用户输入：${result.question}`,
        },
      ],
      details: {
        senera: {
          toolName,
        },
      },
      terminate: true,
    };
  }

  private projectToolResult(tool: RegisteredTool, result: ExecutedToolCallResult | undefined): AgentPiToolResult {
    const content = result
      ? renderOpenAiToolObservationContent(projectToolObservation(result), {
          model: this.options.model,
          observation: tool.observation,
        })
      : JSON.stringify({
          type: "senera.tool_observation.v1",
          tool_name: tool.name,
          status: "empty",
          summary: "Tool returned no result.",
        });

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
      details: {
        senera: {
          toolName: tool.name,
          artifactUri: result?.artifact?.artifactUri,
          callId: result?.callId,
        },
      },
    };
  }
}

function projectToolFailureDetails(result: ExecutedToolCallResult | undefined): Record<string, unknown> | undefined {
  if (!result) return undefined;
  return {
    toolName: result.name,
    callId: result.callId,
    artifactUri: result.artifact?.artifactUri,
    presentation: result.presentation,
  };
}

function readStructuredToolError(value: unknown): { message: string } | undefined {
  const error = readRecord(value)?.error;
  const record = readRecord(error);
  if (!record) {
    return undefined;
  }

  return {
    message: String(record.message ?? stringifyPreview(record)),
  };
}

function projectToolObservation(result: ExecutedToolCallResult): Record<string, unknown> {
  return {
    callId: result.callId,
    name: result.name,
    arguments: result.arguments,
    process: result.process,
    result: redactArtifactSecrets(result.result, result.artifactPolicy),
    artifact: result.artifact,
  };
}
