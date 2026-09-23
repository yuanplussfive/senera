import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import {
  AgentPiToolObservationSourceViewProtocol,
  type AgentPiToolObservationSourceView,
} from "../../../Source/AgentSystem/PiShared/AgentPiToolObservationProtocol.js";
import {
  AgentToolObservationContextCompiler,
  type AgentToolObservationContextCompilerInput,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationContextCompiler.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";
import type { AgentToolObservationProjectionManifest } from "../../../Source/AgentSystem/Types/AgentToolObservationProjectionTypes.js";

const compiler = new AgentToolObservationContextCompiler({ model: "test-model" });

export function compilePiToolObservation(
  overrides: Partial<AgentToolObservationContextCompilerInput> = {},
  manifest: AgentToolObservationProjectionManifest = StandardAgentToolObservationProjection,
): AgentPiToolObservation {
  const callId = String(overrides.callId ?? "call-1");
  const observation = compiler.compile(
    {
      toolName: "TestTool",
      callId,
      batchId: "batch-1",
      status: "success",
      executionStatus: "completed",
      outputAvailability: "complete",
      outcome: {},
      process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
      error: undefined,
      result: { ok: true },
      arguments: {},
      artifact: {
        artifactUri: `senera://artifact/${callId}`,
        evidence: [],
        delta: [],
      },
      ...overrides,
    },
    manifest,
  );
  const parsed = readAgentPiToolObservation(JSON.stringify(observation));
  if (!parsed) throw new Error("Production observation compiler returned an invalid Pi tool observation.");
  return parsed;
}

/**
 * v5 omits the completeness view for fully projected observations, so tests
 * that simulate bounded/truncated views must rebuild the view explicitly
 * with its protocol marker.
 */
export function boundPiToolObservationView(
  observation: AgentPiToolObservation,
  patch: Partial<AgentPiToolObservationSourceView> = {},
): AgentPiToolObservationSourceView {
  return {
    type: AgentPiToolObservationSourceViewProtocol.type,
    complete: true,
    omission_count: 0,
    omissions: [],
    ...observation.observation_view,
    ...patch,
  };
}

export function piToolResultMessage(
  observation: AgentPiToolObservation,
  identity: { toolCallId: string; toolName: string } = { toolCallId: "call-1", toolName: "TestTool" },
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: identity.toolCallId,
    toolName: identity.toolName,
    content: [{ type: "text", text: JSON.stringify(observation) }],
    isError: observation.status === "failure",
    timestamp: Date.now(),
  } as AgentMessage;
}
