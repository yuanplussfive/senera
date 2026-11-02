import fs from "node:fs";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentImageVisionModelClient } from "../../../Source/AgentSystem/Vision/AgentImageVisionModelClient.js";
import { createImageAnalyzeSystemTool } from "../../../Source/AgentSystem/SystemTools/ImageAnalyzeSystemTool.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { AgentResourceResolver } from "../../../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import { resolveUploadsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentResolvedUpload } from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";
import type { AgentImageNormalizationService } from "../../../Source/AgentSystem/Images/AgentImageNormalizationService.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { loadSystemToolContractByCapability, materializeSystemToolArguments } from "./SystemToolContractTestSupport.js";

const identityImageNormalization: Pick<AgentImageNormalizationService, "normalize"> = {
  normalize: async (input) => ({
    bytes: Buffer.from(input.bytes),
    mime: input.mime,
    animated: false,
    sourceSha256: input.sourceSha256,
    policyKey: "test-image-policy",
    derived: false,
  }),
};

function createTestImageAnalyzeSystemTool(
  configuration?: Record<string, unknown>,
  conversationModelProviderId?: string,
  imageNormalization: Pick<AgentImageNormalizationService, "normalize"> = identityImageNormalization,
) {
  return createImageAnalyzeSystemTool(configuration, conversationModelProviderId, {
    imageNormalization,
  });
}

describe("ImageAnalyze system tool", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const directory of temporaryDirectories.splice(0)) removeDirectory(directory);
  });

  it("applies the extension model and prompt configuration to the vision request", async () => {
    const prompt = "用户正在排查上传失败。请逐字提取截图里的报错，并说明与文件大小有关的可见证据，使用中文。";
    const workspaceRoot = createTemporaryDirectory("senera-image-analyze");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "image.png");
    fs.writeFileSync(filePath, "image-content");
    const upload = resolvedUpload(filePath, fs.statSync(filePath).size);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "visible evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });
    const tool = createTestImageAnalyzeSystemTool(
      {
        model: { modelProviderId: "vision-model" },
        prompt: { systemPrompt: "Configured visual evidence policy." },
      },
      "chat-model",
    );

    const output = await tool.execute(
      { images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }], prompt },
      hostContext(workspaceRoot, upload),
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ Id: "vision-model" }),
        systemPrompt: "Configured visual evidence policy.",
        prompt,
        images: [
          { name: upload.manifest.name, mime: "image/png", base64: Buffer.from("image-content").toString("base64") },
        ],
      }),
    );
    expect(output).toMatchObject({ answer: "visible evidence", model: "gpt-vision" });
  });

  it("normalizes image input against the selected vision model contract", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-model-contract");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "image.png");
    fs.writeFileSync(filePath, "image-content");
    const normalized = Buffer.from("normalized-image");
    const normalize = vi.fn(async (input) => ({
      bytes: normalized,
      mime: "image/webp",
      width: 20,
      height: 10,
      animated: false,
      sourceSha256: input.sourceSha256,
      policyKey: "test-image-policy",
      derived: true,
    }));
    vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "visible evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });
    const config = testConfig();
    config.ModelProviders = config.ModelProviders.map((provider) =>
      provider.Id === "vision-model"
        ? {
            ...provider,
            Capabilities: {
              ...provider.Capabilities,
              VisionInput: {
                SupportedMimeTypes: ["image/webp"],
                SupportedAnimatedMimeTypes: ["image/webp"],
                MaxBytes: 4_096,
                MaxPixels: 200,
              },
            },
          }
        : provider,
    );

    await createTestImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } }, "chat-model", {
      normalize,
    }).execute({ images: [{ kind: "local_path", path: "image.png" }], prompt: "Describe the visible evidence." }, {
      workspaceRoot,
      config,
      executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
    } as unknown as AgentHostToolContext);

    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          supportedMimeTypes: ["image/webp"],
          supportedAnimatedMimeTypes: ["image/webp"],
          maxBytes: 4_096,
          maxPixels: 200,
        },
        transferSource: true,
      }),
    );
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

    await createTestImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } }).execute(
      { images: [{ kind: "local_path", path: "image.png" }], prompt: "Describe the visible evidence." },
      {
        workspaceRoot,
        config,
        deadline: { signal: controller.signal, timeoutMs: 120_000, extendTo, close: vi.fn() },
        executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
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

    await createTestImageAnalyzeSystemTool({
      model: { modelProviderId: "vision-model" },
      remote: { allowPrivateNetworks: true },
    }).execute(
      {
        images: [{ kind: "http_url", url: "http://127.0.0.1/example.png" }],
        prompt: "Describe the visible evidence.",
        timeoutMs: 10_000,
      },
      {
        workspaceRoot: process.cwd(),
        config,
        deadline: { signal: controller.signal, timeoutMs: 120_000, extendTo, close: vi.fn() },
      } as unknown as AgentHostToolContext,
    );

    expect(extendTo).toHaveBeenCalledWith(14_000);
  });

  it("rejects an image before reading it when the source safety budget is exceeded", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-budget");
    temporaryDirectories.push(workspaceRoot);
    const upload = resolvedUpload(path.join(workspaceRoot, "missing.png"), 1_025);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");
    const tool = createTestImageAnalyzeSystemTool({ input: { maxSourceImageBytes: 1_024 } });

    await expect(
      tool.execute(
        {
          images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }],
          prompt: "Describe the visible evidence.",
        },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toMatchObject({
      messageKey: "vision.imageSourceTooLarge",
      messageParams: { size: 1_025, maxSourceImageBytes: 1_024 },
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("normalizes a source above the delivery budget before sending it to the vision model", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-source-normalization");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "source.png");
    const source = Buffer.alloc(2_048, 7);
    const normalized = Buffer.from("normalized-image");
    fs.writeFileSync(filePath, source);
    const upload = resolvedUpload(filePath, source.byteLength);
    const normalize = vi.fn(async (input) => ({
      bytes: normalized,
      mime: "image/webp",
      width: 20,
      height: 10,
      animated: false,
      sourceSha256: input.sourceSha256,
      policyKey: "test-image-policy",
      derived: true,
    }));
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "compressed source evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });

    await createTestImageAnalyzeSystemTool({ input: { maxSourceImageBytes: 4_096, maxImageBytes: 1_024 } }, undefined, {
      normalize,
    }).execute(
      {
        images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }],
        prompt: "Describe the visible evidence.",
      },
      hostContext(workspaceRoot, upload),
    );

    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: source,
        target: expect.objectContaining({ maxBytes: 1_024 }),
      }),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ name: "image.png", mime: "image/webp", base64: normalized.toString("base64") }],
      }),
    );
  });

  it("does not send a normalizer result outside the selected model media contract", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-normalizer-contract");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "source.png");
    fs.writeFileSync(filePath, "image-content");
    const upload = resolvedUpload(filePath, fs.statSync(filePath).size);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");

    await expect(
      createTestImageAnalyzeSystemTool(undefined, undefined, {
        normalize: async (input) => ({
          bytes: Buffer.from(input.bytes),
          mime: "image/gif",
          animated: false,
          sourceSha256: input.sourceSha256,
          policyKey: "test-image-policy",
          derived: true,
        }),
      }).execute(
        {
          images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }],
          prompt: "Describe the visible evidence.",
        },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toThrow("Image normalizer returned media outside the selected model input contract.");
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not send an animated result when the selected model declares only static WebP", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-animation-contract");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "source.png");
    fs.writeFileSync(filePath, "image-content");
    const upload = resolvedUpload(filePath, fs.statSync(filePath).size);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");

    await expect(
      createTestImageAnalyzeSystemTool(undefined, undefined, {
        normalize: async (input) => ({
          bytes: Buffer.from(input.bytes),
          mime: "image/webp",
          animated: true,
          sourceSha256: input.sourceSha256,
          policyKey: "test-image-policy",
          derived: false,
        }),
      }).execute(
        {
          images: [{ kind: "senera_resource", uri: upload.manifest.resourceUri }],
          prompt: "Describe the visible evidence.",
        },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toThrow("Image normalizer returned media outside the selected model input contract.");
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
          result: { screenshot: "asset:browser-screenshot-fixture/" },
          outcome: AgentToolSuccessOutcome,
        },
      ],
    });
    const resourceUri = recorded?.artifact?.assets?.find(
      (asset) => asset.id === "browser-screenshot-fixture",
    )?.resourceUri;
    expect(resourceUri).toMatch(/^senera:\/\/resource\/[0-9a-hjkmnp-tv-z]{6}$/u);
    const uploadStore = new AgentUploadStore({
      workspaceRoot,
      config: resolveUploadsConfig(testConfig()),
    });
    const resolveImageForModel = vi.spyOn(uploadStore, "resolveImageForModel");
    const resolver = new AgentResourceResolver({
      workspaceRoot,
      config: testConfig(),
      uploadStore,
    });
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete").mockResolvedValue({
      text: "browser screenshot evidence",
      provider: { id: "vision-model", endpoint: "ChatCompletions", model: "gpt-vision" },
    });

    const output = await createTestImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } }).execute(
      { images: [{ kind: "senera_resource", uri: resourceUri! }], prompt: "Describe the visible evidence." },
      {
        workspaceRoot,
        config: testConfig(),
        uploadStore,
        resourceResolver: resolver,
      } as unknown as AgentHostToolContext,
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { name: "browser-screenshot-fixture.png", base64: screenshotBytes.toString("base64"), mime: "image/png" },
        ],
      }),
    );
    expect(output).toMatchObject({
      images: [{ source: { kind: "senera_resource", uri: resourceUri } }],
      answer: "browser screenshot evidence",
    });
    expect(resolveImageForModel).not.toHaveBeenCalled();
  });

  it("reports an unavailable canonical resource without leaking upload storage paths", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-resource-missing");
    temporaryDirectories.push(workspaceRoot);

    await expect(
      createTestImageAnalyzeSystemTool().execute(
        {
          images: [{ kind: "senera_resource", uri: "senera://resource/browser-screenshot-missing" }],
          prompt: "Describe the visible evidence.",
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

    const output = await createTestImageAnalyzeSystemTool({
      model: { modelProviderId: "vision-model" },
      remote: { allowPrivateNetworks: true },
    }).execute(
      {
        images: [{ kind: "http_url", url: "http://127.0.0.1/example.png" }],
        prompt: "Transcribe the visible text exactly.",
        timeoutMs: 10_000,
      },
      {
        workspaceRoot: process.cwd(),
        config: testConfig(),
      } as AgentHostToolContext,
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ name: "example.png", base64: imageBytes.toString("base64"), mime: "image/png" }],
      }),
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
    const tool = createTestImageAnalyzeSystemTool({ model: { modelProviderId: "vision-model" } });
    const context = {
      workspaceRoot,
      config: testConfig(),
      uploadStore: { resolve: vi.fn().mockResolvedValue(undefined) },
      executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
    } as unknown as AgentHostToolContext;

    const output = await tool.execute(
      { images: [{ kind: "local_path", path: "local-image.png" }], prompt: "Describe the visible evidence." },
      context,
    );
    await tool.execute(
      { images: [{ kind: "local_path", path: imagePath }], prompt: "Describe the visible evidence." },
      context,
    );

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { name: "local-image.png", mime: "image/png", base64: Buffer.from("local-image-content").toString("base64") },
        ],
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
      createTestImageAnalyzeSystemTool().execute(
        { images: [{ kind: "local_path", path: outsidePath }], prompt: "Describe the visible evidence." },
        {
          workspaceRoot,
          config: testConfig(),
          uploadStore: { resolve: vi.fn().mockResolvedValue(undefined) },
          executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
        } as unknown as AgentHostToolContext,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts ordered resource and HTTP(S) image inputs", () => {
    const contract = loadSystemToolContractByCapability(createImageAnalyzeSystemTool().capability);

    expect(
      materializeSystemToolArguments(contract, {
        images: [{ kind: "senera_resource", uri: "senera://resource/upload-1" }],
        prompt: "Describe the visible evidence.",
      }),
    ).toMatchObject({ ok: true, value: { prompt: "Describe the visible evidence." } });
    expect(
      materializeSystemToolArguments(contract, {
        images: [{ kind: "local_path", path: "images/example.png" }],
        prompt: "Describe the visible evidence.",
      }),
    ).toMatchObject({
      ok: true,
      value: { prompt: "Describe the visible evidence." },
    });
    expect(
      materializeSystemToolArguments(contract, {
        images: [{ kind: "http_url", url: "https://images.example.test/example.png" }],
        prompt: "What is visible?",
      }),
    ).toMatchObject({ ok: true, value: { prompt: "What is visible?" } });
    expect(
      materializeSystemToolArguments(contract, { images: [{ kind: "http_url", url: "file:///tmp/image.png" }] }).ok,
    ).toBe(false);
    expect(
      materializeSystemToolArguments(contract, {
        images: [
          {
            kind: "senera_resource",
            uri: "senera://resource/upload-1",
            url: "https://images.example.test/example.png",
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      materializeSystemToolArguments(contract, {
        images: [{ kind: "http_url", url: "https://images.example.test/example.png" }],
      }).ok,
    ).toBe(false);
    for (const prompt of ["", "   "]) {
      expect(
        materializeSystemToolArguments(contract, {
          images: [{ kind: "local_path", path: "image.png" }],
          prompt,
        }).ok,
      ).toBe(false);
    }
    expect(
      materializeSystemToolArguments(contract, {
        images: [{ kind: "local_path", path: "image.png" }],
        prompt: "Read the error",
        task: "ocr",
      }).ok,
    ).toBe(false);

    const schema = contract.contract.inputSchema;
    expect(schema).toMatchObject({ type: "object" });
    expect(schema.required).toEqual(expect.arrayContaining(["images", "prompt"]));
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

    const output = await createTestImageAnalyzeSystemTool({ remote: { allowPrivateNetworks: true } }).execute(
      {
        images: [
          { kind: "senera_resource", uri: upload.manifest.resourceUri },
          { kind: "http_url", url: "http://127.0.0.1/remote.jpg" },
        ],
        prompt: "Describe the visible evidence.",
      },
      hostContext(workspaceRoot, upload),
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { name: "image.png", mime: "image/png", base64: Buffer.from("local-image").toString("base64") },
          { name: "remote.jpg", mime: "image/jpeg", base64: remoteImage.toString("base64") },
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
    const tool = createTestImageAnalyzeSystemTool({ input: { maxImageCount: 1, maxTotalImageBytes: 1_024 } });

    await expect(
      tool.execute(
        {
          images: [
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
          ],
          prompt: "Describe the visible evidence.",
        },
        hostContext(workspaceRoot, upload),
      ),
    ).rejects.toMatchObject({ messageKey: "vision.imageCountExceeded" });
    await expect(
      createTestImageAnalyzeSystemTool({ input: { maxTotalImageBytes: 1_024 } }).execute(
        {
          images: [
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
            { kind: "senera_resource", uri: upload.manifest.resourceUri },
          ],
          prompt: "Describe the visible evidence.",
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
