import { createRequestId } from "../Core/AgentIds.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AskUserControlResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { renderOpenAiToolObservationContent } from "../ToolRuntime/AgentToolObservationRenderer.js";
import {
  readRecord,
  stringifyPreview,
} from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { readPiProxyToolCallBatchId } from "../PiProxy/AgentPiProxyRuntimeContext.js";
import type {
  AgentPiToolExecutionInput,
  AgentPiToolResult,
} from "./AgentPiTypes.js";

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
    const batchId = readPiProxyToolCallBatchId(
      input.context.piProxyRuntimeContextId,
      input.toolCallId,
    );
    const execution = await this.options.executeToolCall(
      {
        name: input.tool.name,
        arguments: input.params,
        callId: input.toolCallId,
      },
      {
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
      requestId,
      step,
      results: execution.value,
    });
    const result = recorded ?? execution.value[0];
    const error = readStructuredToolError(result?.result);
    if (error) {
      throw new AgentPiToolExecutionError(error.message, result);
    }

    return this.projectToolResult(input.tool.name, result);
  }

  private projectAskUser(
    toolName: string,
    result: AskUserControlResult,
  ): AgentPiToolResult {
    return {
      content: [{
        type: "text",
        text: `工具 ${toolName} 需要用户输入：${result.question}`,
      }],
      details: {
        senera: {
          toolName,
          result,
        },
      },
      terminate: true,
    };
  }

  private projectToolResult(
    toolName: string,
    result: ExecutedToolCallResult | undefined,
  ): AgentPiToolResult {
    const content = result
      ? renderOpenAiToolObservationContent(projectToolObservation(result), {
          model: this.options.model,
        })
      : JSON.stringify({
          type: "senera.tool_observation.v1",
          tool_name: toolName,
          status: "empty",
          summary: "Tool returned no result.",
        });

    return {
      content: [{
        type: "text",
        text: content,
      }],
      details: {
        senera: {
          toolName,
          result: result?.result,
          artifactUri: result?.artifact?.artifactUri,
          callId: result?.callId,
          executed: result,
        },
      },
    };
  }
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
    result: result.artifact ? undefined : result.result,
    artifact: result.artifact,
  };
}
