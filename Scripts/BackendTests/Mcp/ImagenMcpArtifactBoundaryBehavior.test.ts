import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentMcpToolClientPool } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClientPool.js";
import { AgentMcpToolRunner } from "../../../Source/AgentSystem/Mcp/AgentMcpToolRunner.js";
import type { AgentMcpToolClient } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig, resolveUploadsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { AgentToolExecutionReporter } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExecutionReporter.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import type { AgentToolRunnerContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
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
          text: "Generated image",
          content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Generated image" })]),
          resources: [
            expect.objectContaining({
              source: {
                kind: "local_path",
                path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png$/u),
              },
              mime: "image/png",
            }),
          ],
        }),
      }),
    );
    expect(JSON.stringify(execution.response)).not.toMatch(/senera:\/\/resource\/upl_/u);
    expect(execution.artifactPayload?.assets).toBeUndefined();
    expect(execution.artifactPayload?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resource",
          locator: "https://example.test/source.png",
        }),
      ]),
    );
    expect(JSON.stringify(execution.artifactPayload?.rawResponse)).not.toContain(imageBase64);
    expect(JSON.stringify(execution.artifactPayload?.rawResponse)).toContain("senera://resource/upl_");
  });

  test("publishes MCP binary content before model projection and removes temporary identities", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-resource-publish");
    temporaryDirectories.push(workspaceRoot);
    const imageBase64 = Buffer.from("standard-mcp-image").toString("base64");
    const uploadStore = new AgentUploadStore({
      workspaceRoot,
      config: resolveUploadsConfig({ ModelProviders: [] }),
    });
    const execution = await runMcpTool(
      {
        content: [
          { type: "text", text: "Generated image" },
          { type: "image", data: imageBase64, mimeType: "image/png" },
        ],
      },
      uploadStore,
    );

    const result = execution.response && "result" in execution.response ? execution.response.result : undefined;
    expect(result).toEqual(
      expect.objectContaining({
        text: "Generated image",
        content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Generated image" })]),
        resources: [
          expect.objectContaining({
            source: {
              kind: "local_path",
              path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png$/u),
            },
            mime: "image/png",
          }),
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/senera:\/\/resource\/upl_/u);
    expect(execution.artifactPayload?.assets).toBeUndefined();
    expect(JSON.stringify(execution.artifactPayload?.rawResponse)).not.toContain(imageBase64);

    const resourceUri = (
      execution.artifactPayload?.rawResponse as { content: Array<{ resource?: { uri?: string } }> }
    ).content.find((item) => item.resource?.uri)?.resource?.uri;
    expect(resourceUri).toMatch(/^senera:\/\/resource\/upl_[a-f0-9]{32}$/u);
    if (!resourceUri) throw new Error("MCP resource URI was not projected.");
    const resolved = await uploadStore.resolve(resourceUri);
    expect(resolved?.manifest).toEqual(
      expect.objectContaining({ resourceUri, mime: "image/png", size: Buffer.from(imageBase64, "base64").length }),
    );
  });

  test("publishes multi-megabyte image content without overflowing the base64 validator stack", async () => {
    const imageBase64 = Buffer.alloc(6 * 1024 * 1024, 0x41).toString("base64");
    const execution = await runMcpTool({
      content: [{ type: "image", data: imageBase64, mimeType: "image/png" }],
    });

    expect(execution.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: {
          resources: [
            expect.objectContaining({
              source: {
                kind: "local_path",
                path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png$/u),
              },
              mime: "image/png",
            }),
          ],
        },
      }),
    );
    expect(JSON.stringify(execution.response)).not.toContain(imageBase64);
  });

  test("publishes every image in a multi-image result through the upload quota", async () => {
    const execution = await runMcpTool({
      content: Array.from({ length: 8 }, (_, index) => ({
        type: "image",
        data: Buffer.from(`image-${index}`).toString("base64"),
        mimeType: "image/png",
      })),
    });

    expect(execution.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: {
          resources: expect.arrayContaining(
            Array.from({ length: 8 }, () =>
              expect.objectContaining({
                source: {
                  kind: "local_path",
                  path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png$/u),
                },
                mime: "image/png",
              }),
            ),
          ),
        },
      }),
    );
    const resources = (execution.response as { result: { resources: Array<{ source: { path: string } }> } }).result
      .resources;
    const paths = resources.map((resource) => resource.source.path);
    expect(new Set(paths).size).toBe(8);
  });

  test("projects inline media in text content without knowing the producing tool", async () => {
    const encoded = "A".repeat(20_000);
    const execution = await runMcpTool({
      content: [{ type: "text", text: `![generated](data:image/png;base64,${encoded})` }],
    });

    expect(JSON.stringify(execution.response)).not.toContain(encoded);
    expect(JSON.stringify(execution.response)).toMatch(/\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png/u);
    expect(JSON.stringify(execution.response)).not.toMatch(/senera:\/\/resource\/upl_/u);
  });

  test("materializes structured Base64 only when magic bytes identify media", async () => {
    const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const execution = await runMcpTool({
      structuredContent: {
        output: {
          image: encoded,
        },
      },
    });

    expect(execution.validationResult).toEqual({
      output: {
        image: encoded,
      },
    });
    expect(execution.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: {
          output: {
            image: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png$/u),
          },
          resources: [
            expect.objectContaining({
              source: {
                kind: "local_path",
                path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.png$/u),
              },
              mime: "image/png",
            }),
          ],
        },
      }),
    );
    expect(JSON.stringify(execution.response)).not.toContain(encoded);
    expect(JSON.stringify(execution.artifactPayload?.rawResponse)).not.toContain(encoded);
  });

  test("does not guess a resource from an undeclared bare Base64 field", async () => {
    const encoded = Buffer.from("provider-defined-value").toString("base64");
    const execution = await runMcpTool({ structuredContent: { payload: encoded } });

    expect(execution.response).toEqual(expect.objectContaining({ ok: true, result: { payload: encoded } }));
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
        result: {
          providerValue: { ok: true },
          resources: [
            expect.objectContaining({
              source: {
                kind: "local_path",
                path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.wav$/u),
              },
              mime: "audio/wav",
            }),
          ],
        },
      }),
    );
    expect(execution.artifactPayload?.assets).toBeUndefined();
    expect(execution.artifactPayload?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "mcp-content", locator: "$.content[0]" }),
        expect.objectContaining({
          kind: "resource",
          locator: expect.stringMatching(/^senera:\/\/resource\/upl_[a-f0-9]{32}$/u),
        }),
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
          kind: "resource",
          locator: expect.stringMatching(/^senera:\/\/resource\/upl_[a-f0-9]{32}$/u),
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

  test("does not derive resources from provider-specific metadata", async () => {
    const execution = await runMcpTool({
      structuredContent: { text: "safe result" },
      _meta: {
        "ai.senera/artifact": {
          assets: [
            {
              id: "provider-local-id",
              fileName: "provider-local.png",
              mediaType: "image/png",
              dataBase64: Buffer.from("provider-local-bytes").toString("base64"),
            },
          ],
        },
      },
    });

    expect(execution.response).toEqual(expect.objectContaining({ ok: true, result: { text: "safe result" } }));
    expect(execution.artifactPayload?.assets).toBeUndefined();
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
          result: { attachment: "senera://resource/response" },
          outcome: AgentToolSuccessOutcome,
        },
      ],
    });

    expect(recorded?.result).toEqual({
      attachment: expect.stringMatching(/^senera:\/\/resource\/res_[a-f0-9]{32}$/u),
    });
    expect(recorded?.artifact?.assets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "response", fileName: "response.json" })]),
    );
    expect(
      JSON.parse(await fs.readFile(path.join(recorded!.artifact!.artifactPath, "raw.response.json"), "utf8")),
    ).toEqual({ source: "mcp" });
    expect(await fs.readFile(path.join(recorded!.artifact!.artifactPath, "assets", "response.json"))).toEqual(
      jsonBytes,
    );
  });
});

async function runMcpTool(value: unknown, resourcePublisher?: AgentUploadStore) {
  let publisher = resourcePublisher;
  if (!publisher) {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-runner-resource");
    temporaryDirectories.push(workspaceRoot);
    publisher = new AgentUploadStore({ workspaceRoot, config: resolveUploadsConfig({ ModelProviders: [] }) });
  }
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
    resourcePublisher: publisher,
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
