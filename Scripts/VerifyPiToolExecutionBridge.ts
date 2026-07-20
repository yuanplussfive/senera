import assert from "node:assert/strict";
import type { AgentToolCallExecutionContext } from "../Source/AgentSystem/ToolRuntime/AgentToolCallExecutionTypes.js";
import {
  AgentPiToolExecutionBridge,
  AgentPiToolExecutionError,
} from "../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ExecutedToolCallArtifact, ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const tool = createToolFixture("SeneraEchoTool");

async function main(): Promise<void> {
  await verifyToolResultProjection();
  await verifyLargeToolResultProjectionIsBudgeted();
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
    executeToolCall: async (request, context = {}) => {
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
      requestId: "verify-pi-tool-bridge",
      step: 2,
      visibleToolNames: ["SeneraEchoTool"],
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.context.loadedToolNames, ["SeneraEchoTool"]);
  assert.deepEqual(calls[0]?.request, {
    name: "SeneraEchoTool",
    arguments: {
      text: "hello",
    },
    callId: "call_echo",
  });
  assert.equal(result.details.senera.toolName, "SeneraEchoTool");
  assert.equal(result.details.senera.callId, "call_echo");
  assert.equal(result.details.senera.artifactUri, "senera://artifact/art_0123456789abcdef01234567");
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /senera\.tool_observation\.v1/);
  assert.match(text, /evidence_uri/);
  assert.match(text, /projection/);
  assert.match(text, /complete current projection/);
}

async function verifyLargeToolResultProjectionIsBudgeted(): Promise<void> {
  const hugeText = "workspace-result\n".repeat(240_000);
  const artifact = artifactFixtureRequired();
  const evidence = artifact.evidence[0];
  assert.ok(evidence);
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
        artifact: {
          ...artifact,
          summary: hugeText,
          evidence: [
            {
              ...evidence,
              modelSlots: [
                {
                  name: "text",
                  value: hugeText,
                },
              ],
            },
          ],
        },
      })),
  });

  const result = await bridge.execute({
    tool,
    toolCallId: "call_large",
    params: {},
    context: {},
  });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";

  assert.match(text, /\.\.\./);
  assert.equal(text.includes(hugeText.slice(0, 200_000)), false);
  assert.ok(text.length < 24_000, `Pi tool result text should stay within its token projection, got ${text.length}`);
  assert.ok(JSON.stringify(result).length < 32_000, "Pi persisted tool details must not retain the raw result.");
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
    context: {},
  });

  assert.equal(result.terminate, true);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /需要用户输入/);
}

async function verifyStructuredToolErrorProjection(): Promise<void> {
  const bridge = new AgentPiToolExecutionBridge({
    model: "test-model",
    executeToolCall: async () => ({
      kind: "ToolResults",
      value: [
        executedToolResult({
          callId: "call_error",
          result: {
            error: {
              code: "ToolFailed",
              message: "工具执行失败",
            },
          },
          exitCode: 1,
        }),
      ],
    }),
    recordToolArtifacts: async ({ results }) => [...results],
  });

  await assert.rejects(
    bridge.execute({
      tool,
      toolCallId: "call_error",
      params: {},
      context: {},
    }),
    (error: unknown) => error instanceof AgentPiToolExecutionError && error.message === "工具执行失败",
  );
}

function createToolFixture(name: string): RegisteredTool {
  return {
    name,
    descriptionFile: undefined,
    signatureFile: undefined,
    signatureType: undefined,
    permissions: [],
    handler: {
      kind: "HostCapability",
      capability: "verify",
    },
    evidenceCapabilities: [],
    plugin: {
      rootPath: "System/Plugins/Verify",
      rootKind: "System",
      manifestPath: "System/Plugins/Verify/PluginManifest.json",
      config: {
        path: "System/Plugins/Verify/PluginConfig.json",
        values: {},
      },
      manifest: {
        Plugin: {
          Name: "VerifyPlugin",
          Title: "Verify Plugin",
          Version: "1.0.0",
          Description: "Verification fixture.",
        },
      },
    },
  } as unknown as RegisteredTool;
}

function executedToolResult(options: { callId?: string; result: unknown; exitCode?: number }): ExecutedToolCallResult {
  return {
    callId: options.callId ?? "call_echo",
    name: "SeneraEchoTool",
    arguments: {
      text: "hello",
    },
    process: {
      exitCode: options.exitCode ?? 0,
      signal: null,
      stderr: "",
    },
    result: options.result,
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
