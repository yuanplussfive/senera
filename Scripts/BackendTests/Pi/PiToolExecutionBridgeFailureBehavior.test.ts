import { describe, expect, test } from "vitest";
import {
  AgentPiToolExecutionBridge as AgentPiToolExecutionBridgeBase,
  type AgentPiToolExecutionBridgeOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentPiToolResultStatuses } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { createTestToolObservationCompressor } from "../Support/PiToolObservationFixtures.js";

class AgentPiToolExecutionBridge extends AgentPiToolExecutionBridgeBase {
  constructor(
    options: Omit<AgentPiToolExecutionBridgeOptions, "model" | "observationTokenBudget" | "observationCompressor">,
  ) {
    super({
      ...options,
      model: "test-model",
      observationTokenBudget: 2_048,
      observationCompressor: createTestToolObservationCompressor(),
    });
  }
}

describe("Pi tool execution bridge failures", () => {
  test("returns an execution failure observation when a tool cannot produce a result", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [] }),
      recordToolArtifacts: async () => [],
    });

    const result = await bridge.execute({
      tool: registeredTool("EmptyTool"),
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
      detail: {
        result: {
          error: {
            code: AgentExecutionErrorCodes.ToolExecutionError,
            message: "Tool execution completed without a result.",
          },
        },
      },
    });
    expect(result.details.senera).toMatchObject({
      status: AgentPiToolResultStatuses.Failure,
      error: { message: "Tool execution completed without a result." },
    });
  });

  test("reports media projection failure without finalizing the observation reservation twice", async () => {
    const executed = toolResult({
      callId: "call-media-missing",
      name: "ImageTool",
      artifact: {
        artifactId: "artifact-media",
        artifactUri: "senera://artifact/art_3123456789abcdef01234567",
        artifactPath: "E:/workspace/.senera/artifacts/media",
        relativePath: "media.json",
        manifestPath: "E:/workspace/.senera/artifacts/media/manifest.json",
        files: {},
        summary: "Generated image",
        assets: [
          {
            id: "image-1",
            resourceUri: "senera://resource/missing-image",
            fileName: "image.png",
            mediaType: "image/png",
            relativePath: "image.png",
            workspacePath: "E:/workspace/.senera/artifacts/media/image.png",
            byteLength: 12,
            sha256: "missing",
          },
        ],
        evidence: [],
        delta: [],
      },
    });
    const bridge = new AgentPiToolExecutionBridge({
      modelSupportsImages: true,
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });
    const context = createToolContext("ImageTool", "call-media-missing");

    const result = await bridge.execute({
      tool: registeredTool("ImageTool"),
      params: {},
      toolCallId: "call-media-missing",
      context,
    });

    expect(parseObservation(result)).toMatchObject({
      status: "success",
      detail: { notice: expect.stringContaining("media_projection_failed") },
    });
    expect(result.details.senera).toMatchObject({
      status: AgentPiToolResultStatuses.Success,
      mediaProjection: { code: "media_projection_failed" },
    });
    expect(context.tokenBudget.snapshot().pendingToolReservations).toBe(0);
  });

  test("preserves a successful tool result when Artifact persistence is unavailable", async () => {
    const executed = toolResult({
      callId: "call-artifact",
      name: "ArtifactTool",
      artifactPayload: { rawResponse: { private: "artifact-only" } },
      artifact: {
        artifactId: "artifact-stale",
        artifactUri: "senera://artifact/art_4123456789abcdef01234567",
        artifactPath: "E:/workspace/.senera/artifacts/stale",
        relativePath: ".senera/artifacts/stale",
        manifestPath: "E:/workspace/.senera/artifacts/stale/manifest.json",
        files: {},
        summary: "stale",
        evidence: [],
        delta: [],
      },
    });
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
      status: "success",
      observation_view: {
        complete: true,
        omission_count: 0,
        omissions: [],
        artifact_availability: {
          status: "unavailable",
          reason: "recording_failed",
        },
      },
      detail: { result: { ok: true } },
    });
    expect(result.details.senera).toMatchObject({
      status: AgentPiToolResultStatuses.Success,
      artifactAvailability: { status: "unavailable", reason: "recording_failed" },
    });
    const captured = context.turnState.takeExecutedToolResult("call-artifact");
    expect(captured).toMatchObject({
      arguments: { query: "answer" },
      result: { ok: true },
      outcome: { assessment: { status: "success" } },
      artifactAvailability: { status: "unavailable", reason: "recording_failed" },
      presentation: {
        artifactAvailability: { status: "unavailable", reason: "recording_failed" },
      },
    });
    expect(captured).not.toHaveProperty("artifactPayload");
    expect(captured).not.toHaveProperty("artifact");
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

  test("propagates cancellation when Artifact persistence is interrupted", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [toolResult()] }),
      recordToolArtifacts: async () => {
        throw new AgentCancellationError("User stopped while persisting the Artifact.");
      },
    });

    await expect(
      bridge.execute({
        tool: registeredTool("SearchTool"),
        params: {},
        toolCallId: "call-artifact-cancelled",
        context: createToolContext("SearchTool", "call-artifact-cancelled"),
      }),
    ).rejects.toThrow("User stopped while persisting the Artifact.");
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

function registeredTool(name: string): RegisteredTool {
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
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    childGrant: "inherit",
    evidenceCapabilities: [],
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
    systemPrompt: "Test agent system context.",
    userMessage: `Test request for ${toolName}.`,
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
