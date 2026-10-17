import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentImageVisionModelClient } from "../../../Source/AgentSystem/Vision/AgentImageVisionModelClient.js";
import { createImageAnalyzeSystemTool } from "../../../Source/AgentSystem/SystemTools/ImageAnalyzeSystemTool.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { AgentResourceResolver } from "../../../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { ensureObjectRootJsonSchema } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaObjectRoot.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentResolvedUpload } from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("ImageAnalyze system tool", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const directory of temporaryDirectories.splice(0)) removeDirectory(directory);
  });

  it("applies the extension model and prompt configuration to the vision request", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-analyze");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "image.png");
    fs.writeFileSync(filePath, "image-content");
    const upload = resolvedUpload(filePath, fs.statSync(filePath).size);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "visible evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });
    const tool = createImageAnalyzeSystemTool(
      {
        model: { modelProviderId: "vision-model" },
        prompt: { systemPrompt: "Configured visual evidence policy." },
      },
      "chat-model",
    );

    const output = await tool.execute(
      { images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }], task: "describe" },
      hostContext(workspaceRoot, upload),
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ Id: "vision-model" }),
        systemPrompt: "Configured visual evidence policy.",
        images: [{ mime: "image/png", base64: Buffer.from("image-content").toString("base64") }],
      }),
    );
    expect(output).toMatchObject({ answer: "visible evidence", model: "gpt-vision" });
  });

  it("projects the selected model budget into the host tool deadline", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-deadline");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "image.png");
    fs.writeFileSync(filePath, "image-content");
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "visible evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });
    const extendTo = vi.fn();
    const controller = new AbortController();
    const config = testConfig();
    config.ModelProviders = config.ModelProviders.map((provider) =>
      provider.Id === "vision-model"
        ? { ...provider, TimeoutSeconds: 3, FirstTokenTimeoutSeconds: 2, MaxRequestSeconds: 4 }
        : provider,
    );

    await createImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } }).execute(
      { images: [{ kind: "local_path", path: "image.png" }], task: "describe" },
      {
        workspaceRoot,
        config,
        deadline: { signal: controller.signal, timeoutMs: 120_000, extendTo, close: vi.fn() },
      } as unknown as AgentHostToolContext,
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(extendTo).toHaveBeenCalledWith(4_000);
  });

  it("includes remote image download time before the visual request", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(Buffer.from("remote-image"), { headers: { "content-type": "image/png" } })),
    );
    vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "remote evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });
    const extendTo = vi.fn();
    const controller = new AbortController();
    const config = testConfig();
    config.ModelProviders = config.ModelProviders.map((provider) =>
      provider.Id === "vision-model"
        ? { ...provider, TimeoutSeconds: 3, FirstTokenTimeoutSeconds: 2, MaxRequestSeconds: 4 }
        : provider,
    );

    await createImageAnalyzeSystemTool({
      model: { modelProviderId: "vision-model" },
      remote: { allowPrivateNetworks: true },
    }).execute(
      { images: [{ kind: "http_url", url: "http://127.0.0.1/example.png" }], task: "describe", timeoutMs: 10_000 },
      {
        workspaceRoot: process.cwd(),
        config,
        deadline: { signal: controller.signal, timeoutMs: 120_000, extendTo, close: vi.fn() },
      } as unknown as AgentHostToolContext,
    );

    expect(extendTo).toHaveBeenCalledWith(14_000);
  });

  it("rejects an image before reading it when the extension byte budget is exceeded", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-budget");
    temporaryDirectories.push(workspaceRoot);
    const upload = resolvedUpload(path.join(workspaceRoot, "missing.png"), 1_025);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");
    const tool = createImageAnalyzeSystemTool({ input: { maxImageBytes: 1_024 } });

    await expect(
      tool.execute(
        { images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }], task: "describe" },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toMatchObject({
      messageKey: "vision.imageTooLarge",
      messageParams: { size: 1_025, maxImageBytes: 1_024 },
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("reads a browser screenshot from its durable Artifact resource", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-artifact-resource");
    temporaryDirectories.push(workspaceRoot);
    const screenshotBytes = Buffer.from("browser-screenshot-bytes");
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config: resolveArtifactsConfig(testConfig()),
      model: "test-model",
    });
    const [recorded] = await recorder.record({
      requestId: "request-browser-screenshot",
      step: 1,
      results: [
        {
          callId: "call-browser-screenshot",
          name: "BrowserScreenshot",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          artifactPayload: {
            assets: [
              {
                id: "browser-screenshot-fixture",
                fileName: "browser-screenshot-fixture.png",
                mediaType: "image/png",
                dataBase64: screenshotBytes.toString("base64"),
              },
            ],
          },
          result: { screenshot: "senera://resource/browser-screenshot-fixture" },
          outcome: AgentToolSuccessOutcome,
        },
      ],
    });
    const resourceUri = recorded?.artifact?.assets?.find(
      (asset) => asset.id === "browser-screenshot-fixture",
    )?.resourceUri;
    expect(resourceUri).toMatch(/^senera:\/\/resource\/res_[a-f0-9]{32}$/u);
    const resolver = new AgentResourceResolver({
      workspaceRoot,
      config: testConfig(),
      uploadStore: { resolve: vi.fn().mockResolvedValue(undefined) },
    });
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "browser screenshot evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });

    const output = await createImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } }).execute(
      { images: [{ kind: "senera_resource", uri: resourceUri! }], task: "describe" },
      {
        workspaceRoot,
        config: testConfig(),
        resourceResolver: resolver,
      } as unknown as AgentHostToolContext,
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ images: [{ base64: screenshotBytes.toString("base64"), mime: "image/png" }] }),
    );
    expect(output).toMatchObject({
      images: [{ source: { kind: "senera_resource", uri: resourceUri } }],
      answer: "browser screenshot evidence",
    });
  });

  it("reports an unavailable canonical resource without leaking upload storage paths", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-resource-missing");
    temporaryDirectories.push(workspaceRoot);

    await expect(
      createImageAnalyzeSystemTool().execute(
        {
          images: [{ kind: "senera_resource", uri: "senera://resource/browser-screenshot-missing" }],
          task: "describe",
        },
        {
          workspaceRoot,
          config: testConfig(),
          resourceResolver: new AgentResourceResolver({
            workspaceRoot,
            config: testConfig(),
            uploadStore: { resolve: vi.fn().mockResolvedValue(undefined) },
          }),
        } as unknown as AgentHostToolContext,
      ),
    ).rejects.toThrow("Resource was not found: senera://resource/browser-screenshot-missing");
  });

  it("downloads a direct image URL into a bounded base64 vision request", async () => {
    const imageBytes = Buffer.from("remote-image-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(imageBytes, {
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "remote image evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });

    const output = await createImageAnalyzeSystemTool({
      model: { modelProviderId: "vision-model" },
      remote: { allowPrivateNetworks: true },
    }).execute(
      { images: [{ kind: "http_url", url: "http://127.0.0.1/example.png" }], task: "ocr", timeoutMs: 10_000 },
      {
        workspaceRoot: process.cwd(),
        config: testConfig(),
      } as AgentHostToolContext,
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ images: [{ base64: imageBytes.toString("base64"), mime: "image/png" }] }),
    );
    expect(output).toMatchObject({
      images: [
        {
          source: { kind: "http_url", url: "http://127.0.0.1/example.png" },
          name: "example.png",
          mime: "image/png",
          size: imageBytes.byteLength,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ],
      answer: "remote image evidence",
    });
  });

  it("resolves relative and absolute workspace paths without converting them to Senera URIs", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-local-path");
    temporaryDirectories.push(workspaceRoot);
    const imagePath = path.join(workspaceRoot, "local-image.png");
    fs.writeFileSync(imagePath, "local-image-content");
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "local image evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });
    const tool = createImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } });
    const context = {
      workspaceRoot,
      config: testConfig(),
      uploadStore: { resolve: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AgentHostToolContext;

    const output = await tool.execute(
      { images: [{ kind: "local_path", path: "local-image.png" }], task: "describe" },
      context,
    );
    await tool.execute({ images: [{ kind: "local_path", path: imagePath }], task: "describe" }, context);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ mime: "image/png", base64: Buffer.from("local-image-content").toString("base64") }],
      }),
    );
    expect(output).toMatchObject({
      images: [{ source: { kind: "local_path", path: "local-image.png" }, mime: "image/png" }],
    });
  });

  it("rejects local paths outside the active workspace", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-local-path-boundary");
    const outsideRoot = createTemporaryDirectory("senera-image-outside-workspace");
    temporaryDirectories.push(workspaceRoot, outsideRoot);
    const outsidePath = path.join(outsideRoot, "secret.png");
    fs.writeFileSync(outsidePath, "not-readable-by-tool");
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");

    await expect(
      createImageAnalyzeSystemTool().execute(
        { images: [{ kind: "local_path", path: outsidePath }], task: "describe" },
        {
          workspaceRoot,
          config: testConfig(),
          uploadStore: { resolve: vi.fn().mockResolvedValue(undefined) },
        } as unknown as AgentHostToolContext,
      ),
    ).rejects.toThrow("Local resource path is missing or outside the workspace.");
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts ordered resource and HTTP(S) image inputs", () => {
    const input = createImageAnalyzeSystemTool().input;

    expect(input.parse({ images: [{ kind: "senera_resource", uri: "senera://resource/upload-1" }] })).toMatchObject({
      task: "describe",
    });
    expect(input.parse({ images: [{ kind: "local_path", path: "images/example.png" }] })).toMatchObject({
      task: "describe",
    });
    expect(
      input.parse({
        images: [{ kind: "http_url", url: "https://images.example.test/example.png" }],
        task: "question",
        question: "What is visible?",
      }),
    ).toMatchObject({ task: "question" });
    expect(() => input.parse({ images: [{ kind: "http_url", url: "file:///tmp/image.png" }] })).toThrow();
    expect(() =>
      input.parse({
        images: [
          {
            kind: "senera_resource",
            uri: "senera://resource/upload-1",
            url: "https://images.example.test/example.png",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      input.parse({ images: [{ kind: "http_url", url: "https://images.example.test/example.png" }], task: "question" }),
    ).toThrow();

    const schema = ensureObjectRootJsonSchema(z.toJSONSchema(input, { target: "draft-7", io: "input" }));
    expect(schema).toMatchObject({ type: "object" });
    expect(schema.required).toEqual(expect.arrayContaining(["images"]));
    const properties = (schema as { properties?: Record<string, unknown> }).properties;
    expect((properties?.images as { items?: { oneOf?: unknown[] } }).items?.oneOf).toHaveLength(3);
  });

  it("submits mixed image sources in one ordered vision request", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-batch");
    temporaryDirectories.push(workspaceRoot);
    const resourcePath = path.join(workspaceRoot, "local.png");
    fs.writeFileSync(resourcePath, "local-image");
    const upload = resolvedUpload(resourcePath, fs.statSync(resourcePath).size);
    const remoteImage = Buffer.from("remote-image");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(remoteImage, { headers: { "content-type": "image/jpeg" } })),
    );
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "both images",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });

    const output = await createImageAnalyzeSystemTool({ remote: { allowPrivateNetworks: true } }).execute(
      {
        images: [
          { kind: "senera_resource", uri: upload.manifest.resourceUri },
          { kind: "http_url", url: "http://127.0.0.1/remote.jpg" },
        ],
        task: "describe",
      },
      hostContext(workspaceRoot, upload),
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { mime: "image/png", base64: Buffer.from("local-image").toString("base64") },
          { mime: "image/jpeg", base64: remoteImage.toString("base64") },
        ],
      }),
    );
    expect(output.images.map((image) => image.source.kind)).toEqual(["senera_resource", "http_url"]);
  });

  it("enforces image count and aggregate byte limits before calling the vision model", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-batch-limits");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "image.png");
    fs.writeFileSync(filePath, "x".repeat(600));
    const upload = resolvedUpload(filePath, fs.statSync(filePath).size);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");
    const tool = createImageAnalyzeSystemTool({ input: { maxImageCount: 1, maxTotalImageBytes: 1_024 } });

    await expect(
      tool.execute(
        {
          images: [
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
          ],
          task: "describe",
        },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toMatchObject({ messageKey: "vision.imageCountExceeded" });
    await expect(
      createImageAnalyzeSystemTool({ input: { maxTotalImageBytes: 1_024 } }).execute(
        {
          images: [
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
          ],
          task: "describe",
        },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toMatchObject({ messageKey: "vision.imageTotalTooLarge" });
    expect(complete).not.toHaveBeenCalled();
  });
});

function hostContext(workspaceRoot: string, upload: AgentResolvedUpload): AgentHostToolContext {
  return {
    workspaceRoot,
    config: testConfig(),
    uploadStore: { resolve: vi.fn().mockResolvedValue(upload) },
  } as unknown as AgentHostToolContext;
}

function resolvedUpload(filePath: string, size: number): AgentResolvedUpload {
  return {
    manifest: {
      resourceId: "upload-1",
      resourceUri: "senera://resource/upload-1",
      name: "image.png",
      mime: "image/png",
      size,
      sha256: "sha256",
      createdAt: "2026-08-03T00:00:00.000Z",
      storage: { fileName: "image.png" },
    },
    filePath,
    uploadDir: path.dirname(filePath),
  };
}

function testConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "chat-model",
    ModelProviderEndpoints: [{ Id: "openai", Enabled: true, BaseUrl: "https://example.test/v1" }],
    ModelProviders: [
      {
        Id: "chat-model",
        ProviderId: "openai",
        Endpoint: "ChatCompletions",
        Model: "gpt-chat",
        Capabilities: { Vision: false },
      },
      {
        Id: "vision-model",
        ProviderId: "openai",
        Endpoint: "ChatCompletions",
        Model: "gpt-vision",
        Capabilities: { Vision: true },
      },
    ],
  };
}
