import assert from "node:assert/strict";
import type { AgentToolCallExecutionContext } from "../Source/AgentSystem/ToolRuntime/AgentToolCallExecutionTypes.js";
import {
  AgentPiToolExecutionBridge as AgentPiToolExecutionBridgeBase,
  type AgentPiToolExecutionBridgeOptions,
} from "../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentPiToolResultStatuses } from "../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type {
  AgentToolProcessError,
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
} from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { createAgentToolAccessGrant } from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentPiTurnContextRegistry } from "../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import { AgentToolExposureState } from "../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

const turnContexts = new AgentPiTurnContextRegistry();

class AgentPiToolExecutionBridge extends AgentPiToolExecutionBridgeBase {
  constructor(options: Omit<AgentPiToolExecutionBridgeOptions, "turnContexts">) {
    super({ ...options, turnContexts });
  }
}

const tool = createToolFixture("SeneraEchoTool");
const toolAccessGrant = createAgentToolAccessGrant({
  authorizedToolNames: [tool.name],
  exposedToolNames: [tool.name],
  preferredToolNames: [tool.name],
});

async function main(): Promise<void> {
  await verifyToolResultProjection();
  await verifyLargeToolResultRemainsCanonical();
  await verifyAskUserProjection();
  await verifyStructuredToolErrorProjection();

  console.log("Pi tool execution bridge verified.");
}

async function verifyToolResultProjection(): Promise<void> {
  const executed = executedToolResult({
    callId: "call_echo",
    result: {
      summary: "done",
    },
  });
  const calls: Array<{ request: unknown; context: AgentToolCallExecutionContext }> = [];
  const bridge = new AgentPiToolExecutionBridge({
    model: "test-model",
    executeToolCall: async (request, context) => {
      calls.push({ request, context });
      return {
        kind: "ToolResults",
        value: [executed],
      };
    },
    recordToolArtifacts: async ({ results }) =>
      results.map((result) => ({
        ...result,
        artifact: artifactFixture(),
      })),
  });

  const result = await bridge.execute({
    tool,
    toolCallId: "call_echo",
    params: {
      text: "hello",
    },
    context: {
      toolAccessGrant,
      requestId: "verify-pi-tool-bridge",
      step: 2,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.context.toolAccessGrant, toolAccessGrant);
  assert.deepEqual(calls[0]?.request, {
    name: "SeneraEchoTool",
    arguments: {
      text: "hello",
    },
    expectedContractDigest: null,
    callId: "call_echo",
  });
  assert.equal(result.details.senera.toolName, "SeneraEchoTool");
  assert.equal(result.details.senera.callId, "call_echo");
  assert.equal(result.details.senera.artifactUri, "senera://artifact/art_0123456789abcdef01234567");
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /senera\.tool_observation\.v1/);
  assert.match(text, /evidence_uri/);
  assert.match(text, /senera:\/\/artifact\/art_0123456789abcdef01234567/);
}

async function verifyLargeToolResultRemainsCanonical(): Promise<void> {
  const hugeText = "workspace-result\n".repeat(20_000);
  const artifact = artifactFixtureRequired();
  const contextId = turnContexts.register({
    requestId: "verify-pi-large-result",
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
  });
  const bridge = new AgentPiToolExecutionBridge({
    model: "test-model",
    executeToolCall: async () => ({
      kind: "ToolResults",
      value: [
        executedToolResult({
          callId: "call_large",
          result: {
            text: hugeText,
          },
        }),
      ],
    }),
    recordToolArtifacts: async ({ results }) =>
      results.map((result) => ({
        ...result,
        artifact,
      })),
  });

  try {
    const result = await bridge.execute({
      tool,
      toolCallId: "call_large",
      params: {},
      context: { toolAccessGrant, piTurnContextId: contextId },
    });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const observation = JSON.parse(text) as {
      artifact_uri?: string;
      observation_view?: { complete?: boolean };
      detail?: { result?: { text?: string } };
    };
    const captured = turnContexts.takeExecutedToolResult(contextId, "call_large");

    assert.equal(observation.artifact_uri, artifact.artifactUri);
    assert.equal(observation.observation_view?.complete, false);
    assert.notEqual(observation.detail?.result?.text, hugeText);
    assert.deepEqual(captured?.result, { text: hugeText });
    assert.equal(text.includes(hugeText), false);
    assert.equal(JSON.stringify(result.details).includes("workspace-result"), false);
  } finally {
    turnContexts.release(contextId);
  }
}

async function verifyAskUserProjection(): Promise<void> {
  const bridge = new AgentPiToolExecutionBridge({
    model: "test-model",
    executeToolCall: async () => ({
      kind: "AskUser",
      value: {
        question: "需要哪个目录？",
        reason_code: "missing_target",
      },
    }),
    recordToolArtifacts: async () => {
      throw new Error("AskUser should not record artifacts.");
    },
  });

  const result = await bridge.execute({
    tool,
    toolCallId: "call_ask",
    params: {},
    context: { toolAccessGrant, requestId: "verify-pi-ask" },
  });

  assert.equal(result.terminate, true);
  const observation = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "null") as {
    type?: string;
    tool_name?: string;
    call_id?: string;
    batch_id?: string;
    status?: string;
    observation_view?: { type?: string; complete?: boolean };
    detail?: { summary?: string; result?: unknown };
    summary?: unknown;
    control?: unknown;
  };
  assert.equal(observation.type, "senera.tool_observation.v1");
  assert.equal(observation.tool_name, tool.name);
  assert.equal(observation.call_id, "call_ask");
  assert.equal(observation.batch_id, "verify-pi-ask:1");
  assert.equal(observation.status, "waiting");
  assert.equal(observation.observation_view?.type, "senera.tool_observation_source_view.v1");
  assert.equal(observation.observation_view?.complete, true);
  assert.equal(observation.detail?.summary, "需要哪个目录？");
  assert.deepEqual(observation.detail?.result, {
    question: "需要哪个目录？",
    reason_code: "missing_target",
  });
  assert.equal(observation.summary, undefined);
  assert.equal(observation.control, undefined);
}

async function verifyStructuredToolErrorProjection(): Promise<void> {
  const error = {
    code: AgentExecutionErrorCodes.ToolExecutionError,
    message: "工具执行失败",
    diagnostics: [{ message: "工具名称冲突", pointer: "/Tools/0/Name" }],
  };
  const bridge = new AgentPiToolExecutionBridge({
    model: "test-model",
    executeToolCall: async () => ({
      kind: "ToolResults",
      value: [
        executedToolResult({
          callId: "call_error",
          result: {
            error,
          },
          error,
          exitCode: 1,
        }),
      ],
    }),
    recordToolArtifacts: async ({ results }) => [...results],
  });

  const result = await bridge.execute({
    tool,
    toolCallId: "call_error",
    params: {},
    context: { toolAccessGrant },
  });
  assert.equal(result.details.senera.status, AgentPiToolResultStatuses.Failure);
  assert.deepEqual(result.details.senera.error, {
    ...error,
    kind: "execution",
    source: "host",
    retryable: false,
  });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /工具执行失败/);
  assert.match(text, /\/Tools\/0\/Name/);
}

function createToolFixture(name: string): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "verification",
      title: "Verification",
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name,
    loading: "Dynamic",
    descriptionFile: undefined,
    permissions: [],
    handler: {
      kind: "HostCapability",
      capability: "verify",
    },
    evidenceCapabilities: [],
    sources: [],
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
  };
}

function executedToolResult(options: {
  callId?: string;
  result: unknown;
  error?: AgentToolProcessError;
  exitCode?: number;
}): ExecutedToolCallResult {
  return {
    callId: options.callId ?? "call_echo",
    name: "SeneraEchoTool",
    arguments: {
      text: "hello",
    },
    process: {
      exitCode: options.exitCode ?? 0,
      signal: null,
      stdout: "",
      stderr: "",
    },
    result: options.result,
    outcome: options.error
      ? createAgentToolFailureOutcome(options.error, AgentToolFailureSources.Host, "none")
      : AgentToolSuccessOutcome,
  };
}

function artifactFixtureRequired(): ExecutedToolCallArtifact {
  return {
    artifactId: "art_0123456789abcdef01234567",
    artifactUri: "senera://artifact/art_0123456789abcdef01234567",
    artifactPath: "E:/senera/.senera/artifacts/verification",
    relativePath: ".senera/artifacts/verification",
    manifestPath: "E:/senera/.senera/artifacts/verification/manifest.json",
    files: {
      manifest: "E:/senera/.senera/artifacts/verification/manifest.json",
    },
    summary: "done",
    projection: "complete current projection",
    evidence: [
      {
        key: "echo",
        evidenceUri: "senera://evidence/echo",
        kind: "workspace_summary",
        locator: "workspace://.",
        display: "workspace summary",
        label: "workspace",
        source: "done",
        confidence: 1,
        modelSlots: [
          {
            name: "summary",
            value: "done",
          },
        ],
        plannerMemory: {
          facts: [
            {
              name: "summary",
              value: "done",
            },
          ],
          artifactRefs: ["projection"],
        },
      },
    ],
    delta: [],
  };
}

function artifactFixture(): ExecutedToolCallResult["artifact"] {
  return artifactFixtureRequired();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
