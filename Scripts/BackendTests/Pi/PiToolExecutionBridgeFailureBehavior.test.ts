import { describe, expect, test } from "vitest";
import {
  AgentPiToolExecutionBridge as AgentPiToolExecutionBridgeBase,
  type AgentPiToolExecutionBridgeOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentPiToolResultStatuses } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentToolObservationProjectionManifest } from "../../../Source/AgentSystem/Types/AgentToolObservationProjectionTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";

class AgentPiToolExecutionBridge extends AgentPiToolExecutionBridgeBase {
  constructor(options: Omit<AgentPiToolExecutionBridgeOptions, "model">) {
    super({ ...options, model: "test-model" });
  }
}

describe("Pi tool execution bridge failures", () => {
  test("returns an execution failure observation when a tool cannot produce a result", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [] }),
      recordToolArtifacts: async () => [],
    });

    const result = await bridge.execute({
      tool: registeredTool("EmptyTool", fullObservationProjection()),
      params: { query: "inspect" },
      toolCallId: "call-empty",
      context: createToolContext("EmptyTool", "call-empty"),
    });

    expect(parseObservation(result)).toMatchObject({
      status: "failure",
      error: {
        code: AgentExecutionErrorCodes.ToolExecutionError,
        source: "host",
        message: "Tool execution completed without a result.",
      },
      detail: { arguments: { query: "inspect" } },
    });
    expect(result.details.senera).toMatchObject({
      status: AgentPiToolResultStatuses.Failure,
      error: { message: "Tool execution completed without a result." },
    });
  });

  test("keeps artifact persistence failures inside the tool loop for the model to recover from", async () => {
    const executed = toolResult({ callId: "call-artifact", name: "ArtifactTool" });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => {
        throw new Error("Artifact storage is temporarily unavailable.");
      },
    });
    const context = createToolContext("ArtifactTool", "call-artifact");

    const result = await bridge.execute({
      tool: registeredTool("ArtifactTool"),
      params: { path: "notes.md" },
      toolCallId: "call-artifact",
      context,
    });

    expect(parseObservation(result)).toMatchObject({
      status: "failure",
      error: {
        code: AgentExecutionErrorCodes.ToolExecutionError,
        message: "Artifact storage is temporarily unavailable.",
      },
    });
    expect(context.turnState.takeExecutedToolResult("call-artifact")).toMatchObject({
      arguments: { path: "notes.md" },
      outcome: { assessment: { status: "failure" } },
    });
  });

  test("does not turn user cancellation into a tool observation", async () => {
    const controller = new AbortController();
    controller.abort(new AgentCancellationError("User stopped the run."));
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => {
        throw new AgentCancellationError("User stopped the run.");
      },
      recordToolArtifacts: async () => [],
    });

    await expect(
      bridge.execute({
        tool: registeredTool("CancelledTool"),
        params: {},
        toolCallId: "call-cancelled",
        signal: controller.signal,
        context: createToolContext("CancelledTool", "call-cancelled"),
      }),
    ).rejects.toThrow("User stopped the run.");
  });
});

function toolResult(overrides: Partial<ExecutedToolCallResult> = {}): ExecutedToolCallResult {
  return {
    callId: "call-1",
    name: "SearchTool",
    arguments: { query: "answer" },
    process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
    result: { ok: true },
    outcome: AgentToolSuccessOutcome,
    ...overrides,
  };
}

function registeredTool(
  name: string,
  observationProjection: AgentToolObservationProjectionManifest = StandardAgentToolObservationProjection,
): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: `${name}-owner`,
      title: name,
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    loading: "Dynamic",
    name,
    permissions: [],
    sources: [],
    handler: { kind: "HostCapability", capability: name },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      Capabilities: { Cancellation: true },
    },
    observationProjection,
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function fullObservationProjection(): AgentToolObservationProjectionManifest {
  return {
    ...StandardAgentToolObservationProjection,
    maxTokens: 6_000,
    sources: [
      projectionSource("error", "json", "essential", 1_024),
      projectionSource("process", "json", "high", 1_024),
      projectionSource("arguments", "json", "normal", 1_024),
      projectionSource("outcome", "json", "normal", 1_024),
      ...StandardAgentToolObservationProjection.sources,
    ],
  };
}

function projectionSource(
  source: AgentToolObservationProjectionManifest["sources"][number]["source"],
  mode: AgentToolObservationProjectionManifest["sources"][number]["mode"],
  priority: AgentToolObservationProjectionManifest["sources"][number]["priority"],
  maxTokens: number,
): AgentToolObservationProjectionManifest["sources"][number] {
  return {
    source,
    mode,
    priority,
    requiredForCompletion: true,
    maxTokens,
    limits: { maxDepth: 8, maxArrayItems: 32, maxObjectProperties: 48, maxNodes: 384 },
  };
}

function parseObservation(result: Awaited<ReturnType<AgentPiToolExecutionBridge["execute"]>>): Record<string, unknown> {
  return JSON.parse(textContent(result.content[0])) as Record<string, unknown>;
}

function textContent(content: unknown): string {
  return content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content
    ? String(content.text)
    : "";
}

function createToolContext(toolName: string, callId: string) {
  const grant = toolAccessGrant([toolName]);
  const tokenBudget = new AgentTurnTokenBudget({
    model: "test-model",
    contextWindowTokens: 128_000,
    outputReserveTokens: 8_192,
  });
  const turnState = new AgentPiTurnState({
    approvalMode: "agent",
    requestId: `request-${callId}`,
    step: 1,
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget,
  });
  turnState.registerToolBatch(`batch-${callId}`, [{ toolCallId: callId, toolName, input: {} }]);
  return {
    toolAccessGrant: grant,
    toolExposure: turnState.context.toolExposure,
    turnState,
    tokenBudget,
  };
}
