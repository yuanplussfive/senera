import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentMcpToolClientPool } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClientPool.js";
import { AgentMcpToolRunner } from "../../../Source/AgentSystem/Mcp/AgentMcpToolRunner.js";
import type { AgentMcpToolClient } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { AgentToolExecutionReporter } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExecutionReporter.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import type { AgentToolRunnerContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("Imagen MCP artifact boundary", () => {
  test("adapts standard MCP content without requiring a structured output schema", async () => {
    const imageBase64 = Buffer.from("standard-mcp-image").toString("base64");
    const execution = await runMcpTool({
      content: [
        { type: "text", text: "Generated image" },
        { type: "image", data: imageBase64, mimeType: "image/png" },
        {
          type: "resource_link",
          uri: "https://example.test/source.png",
          name: "Source image",
        },
      ],
    });

    expect(JSON.stringify(execution.response)).not.toContain(imageBase64);
    expect(execution.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          text: expect.stringContaining("senera://artifact-asset/mcp-content-2"),
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "image",
              uri: "senera://artifact-asset/mcp-content-2",
            }),
          ]),
        }),
      }),
    );
    expect(execution.artifactPayload?.assets).toEqual([
      {
        id: "mcp-content-2",
        fileName: "mcp-content-2.png",
        mediaType: "image/png",
        dataBase64: imageBase64,
      },
    ]);
    expect(execution.artifactPayload?.evidence).toEqual([
      expect.objectContaining({
        kind: "resource",
        locator: "https://example.test/source.png",
      }),
    ]);
    expect(execution.artifactPayload?.rawResponse).toEqual(
      expect.objectContaining({
        content: expect.arrayContaining([expect.objectContaining({ type: "image", data: imageBase64 })]),
      }),
    );
  });

  test("keeps standard content available as evidence beside opaque structured content", async () => {
    const audioBase64 = Buffer.from("standard-mcp-audio").toString("base64");
    const execution = await runMcpTool({
      structuredContent: { providerValue: { ok: true } },
      content: [
        { type: "text", text: "The provider completed the operation." },
        { type: "audio", data: audioBase64, mimeType: "audio/wav" },
        {
          type: "resource",
          resource: {
            uri: "urn:mcp:report",
            mimeType: "text/plain",
            text: "Embedded report",
          },
        },
      ],
    });

    expect(execution.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: { providerValue: { ok: true } },
      }),
    );
    expect(execution.artifactPayload?.assets).toEqual([
      expect.objectContaining({ id: "mcp-content-2", mediaType: "audio/wav" }),
    ]);
    expect(execution.artifactPayload?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "mcp-content", locator: "$.content[0]" }),
        expect.objectContaining({ kind: "mcp-content", locator: "$.content[1]" }),
        expect.objectContaining({ kind: "mcp-content", locator: "$.content[2]" }),
      ]),
    );
    expect(execution.artifactPayload?.rawResponse).toEqual(
      expect.objectContaining({ structuredContent: { providerValue: { ok: true } } }),
    );

    const workspaceRoot = createTemporaryDirectory("senera-structured-content-assets");
    temporaryDirectories.push(workspaceRoot);
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config: resolveArtifactsConfig({
        ModelProviders: [],
        Artifacts: { RootDir: ".senera/artifacts" },
      } satisfies AgentSystemConfig),
      model: "test-model",
    });
    const [recorded] = await recorder.record({
      requestId: "request-structured-content",
      step: 1,
      results: [
        {
          callId: "call-structured-content",
          name: "mcp__imagen__ImageGenerate",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          artifactPayload: execution.artifactPayload,
          result: execution.response.ok ? execution.response.result : {},
          outcome: AgentToolSuccessOutcome,
        },
      ],
    });
    expect(recorded?.artifact?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "mcp-content",
          locator: expect.stringContaining("assets/mcp-content-2.wav"),
          modelSlots: expect.arrayContaining([
            expect.objectContaining({ name: "asset_uri", value: expect.stringContaining("mcp-content-2.wav") }),
          ]),
        }),
      ]),
    );
  });

  test("keeps arbitrary structured content opaque to the MCP adapter", async () => {
    const execution = await runMcpTool({
      structuredContent: {
        providerSpecificValue: { nested: true },
        imageData: "provider-defined-value",
      },
    });

    expect(execution.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: {
          providerSpecificValue: { nested: true },
          imageData: "provider-defined-value",
        },
      }),
    );
    expect(execution.artifactPayload).toEqual({
      rawResponse: {
        structuredContent: { providerSpecificValue: { nested: true }, imageData: "provider-defined-value" },
      },
    });
  });

  test("archives provider response and image bytes without returning them to the model", async () => {
    const imageBytes = Buffer.from("fake-png");
    const imageBase64 = imageBytes.toString("base64");
    const providerResponse = {
      api_key: "provider-secret",
      data: [{ b64_json: imageBase64, revised_prompt: "A small blue bird." }],
    };
    const modelResult = {
      mode: "images",
      model: "gpt-image-2",
      size: "1536x1024",
      text: "Image generated.",
      markdown: "![Generated image](senera://artifact-asset/imagen-1)",
      images: [
        {
          index: 0,
          alt: "Generated image",
          markdown: "![Generated image](senera://artifact-asset/imagen-1)",
          source: "artifact",
          mediaType: "image/png",
        },
      ],
    };
    const execution = await runMcpTool({
      structuredContent: modelResult,
      _meta: {
        "ai.senera/artifact": {
          rawResponse: providerResponse,
          assets: [
            {
              id: "imagen-1",
              fileName: "imagen-1.png",
              mediaType: "image/png",
              dataBase64: imageBase64,
            },
          ],
        },
      },
    });

    expect(execution.response).toEqual(expect.objectContaining({ ok: true, result: modelResult }));
    expect(JSON.stringify(execution.response)).not.toContain(imageBase64);
    expect(JSON.stringify(execution.response)).not.toContain("provider-secret");
    expect(execution.artifactPayload).toEqual({
      rawResponse: providerResponse,
      assets: [
        {
          id: "imagen-1",
          fileName: "imagen-1.png",
          mediaType: "image/png",
          dataBase64: imageBase64,
        },
      ],
    });

    const workspaceRoot = createTemporaryDirectory("senera-imagen-artifact");
    temporaryDirectories.push(workspaceRoot);
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config: resolveArtifactsConfig({
        ModelProviders: [],
        Artifacts: { RootDir: ".senera/artifacts" },
      } satisfies AgentSystemConfig),
      model: "test-model",
    });
    const [recorded] = await recorder.record({
      requestId: "request-imagen",
      step: 1,
      results: [
        {
          callId: "call-imagen",
          name: "mcp__imagen__ImageGenerate",
          arguments: { prompt: "A small blue bird." },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          artifactPayload: execution.artifactPayload,
          result: modelResult,
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: { Redact: { Keys: ["api_key"] } },
        },
      ],
    });

    expect(recorded).not.toHaveProperty("artifactPayload");
    expect(JSON.stringify(recorded?.result)).not.toContain(imageBase64);
    expect(JSON.stringify(recorded?.result)).not.toContain("provider-secret");
    expect(recorded?.result).toMatchObject({
      markdown: expect.stringContaining("assets/imagen-1.png"),
    });
    expect(recorded?.artifact?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "raw-response", fileName: "response.json" }),
        expect.objectContaining({ id: "imagen-1", fileName: "imagen-1.png", mediaType: "image/png" }),
      ]),
    );

    const rawResponsePath = path.join(recorded!.artifact!.artifactPath, "assets", "response.json");
    expect(await fs.readFile(rawResponsePath, "utf8")).not.toContain("provider-secret");
    expect(await fs.readFile(rawResponsePath, "utf8")).toContain(imageBase64);
    expect(await fs.readFile(path.join(recorded!.artifact!.artifactPath, "assets", "imagen-1.png"))).toEqual(
      imageBytes,
    );
  });

  test("ignores malformed artifact metadata while preserving the safe tool result", async () => {
    const execution = await runMcpTool({
      structuredContent: { text: "safe result" },
      _meta: {
        "ai.senera/artifact": {
          assets: [
            {
              id: "imagen-1",
              fileName: "imagen-1.png",
              mediaType: "image/png",
              dataBase64: "not-base64",
            },
          ],
        },
      },
    });

    expect(execution.response).toEqual(expect.objectContaining({ ok: true, result: { text: "safe result" } }));
    expect(execution.artifactPayload).toEqual(
      expect.objectContaining({
        rawResponse: expect.objectContaining({ structuredContent: { text: "safe result" } }),
      }),
    );
  });

  test("keeps raw responses and plugin assets on distinct artifact paths", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-asset-collision");
    temporaryDirectories.push(workspaceRoot);
    const jsonBytes = Buffer.from('{"ok":true}', "utf8");
    const jsonBase64 = jsonBytes.toString("base64");
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config: resolveArtifactsConfig({
        ModelProviders: [],
        Artifacts: { RootDir: ".senera/artifacts" },
      } satisfies AgentSystemConfig),
      model: "test-model",
    });

    const [recorded] = await recorder.record({
      requestId: "request-asset-collision",
      step: 1,
      results: [
        {
          callId: "call-asset-collision",
          name: "mcp__test__asset",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          artifactPayload: {
            rawResponse: { source: "mcp" },
            assets: [
              {
                id: "response",
                fileName: "response.json",
                mediaType: "application/json",
                dataBase64: jsonBase64,
              },
            ],
          },
          result: { attachment: "senera://artifact-asset/response" },
          outcome: AgentToolSuccessOutcome,
        },
      ],
    });

    expect(recorded?.result).toEqual({
      attachment: expect.stringContaining("assets/response-2.json"),
    });
    expect(recorded?.artifact?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "raw-response", fileName: "response.json" }),
        expect.objectContaining({ id: "response", fileName: "response-2.json" }),
      ]),
    );
    expect(await fs.readFile(path.join(recorded!.artifact!.artifactPath, "assets", "response-2.json"))).toEqual(
      jsonBytes,
    );
  });
});

async function runMcpTool(value: unknown) {
  const client = {
    closed: false,
    callTool: async () => value,
    close: async () => undefined,
  } as unknown as AgentMcpToolClient;
  const pool = new AgentMcpToolClientPool(async () => client);
  const runner = new AgentMcpToolRunner({
    config: { ModelProviders: [] },
    executionEnv: {} as SeneraExecutionEnv,
    clientPool: pool,
  });
  const tool = registeredMcpTool();
  try {
    return await runner.run(tool, {}, executionContext(), new AgentToolExecutionReporter({ toolName: tool.name }));
  } finally {
    await pool.close();
  }
}

function registeredMcpTool(): RegisteredTool {
  return {
    owner: {
      kind: "mcp",
      name: "imagen",
      title: "Imagen",
      rootPath: process.cwd(),
      revision: "test",
      trusted: false,
      requiresApproval: false,
    },
    name: "mcp__imagen__ImageGenerate",
    loading: "Dynamic",
    permissions: [],
    handler: {
      kind: "McpTool",
      server: {
        id: "imagen",
        revision: "test",
        transport: "http",
        url: "https://example.invalid/mcp",
      },
      tool: "ImageGenerate",
      readOnly: false,
    },
    execution: { Targets: ["Local"], Network: "Allow", Workspace: "ReadOnly" },
    runtime: { Lifecycle: "Persistent", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function executionContext(): AgentToolRunnerContext {
  return {
    executionPlan: {
      target: "Local",
      backend: "local",
      network: "default",
      workspaceMount: "readonly",
      availableTargets: ["Local"],
    },
  };
}
