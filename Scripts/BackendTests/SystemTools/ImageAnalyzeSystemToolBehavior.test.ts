import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentImageVisionModelClient } from "../../../Source/AgentSystem/Vision/AgentImageVisionModelClient.js";
import { createImageAnalyzeSystemTool } from "../../../Source/AgentSystem/SystemTools/ImageAnalyzeSystemTool.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentResolvedUpload } from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("ImageAnalyze system tool", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
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
      { uploadUri: upload.manifest.uploadUri, task: "describe" },
      hostContext(workspaceRoot, upload),
    );

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ Id: "vision-model" }),
        systemPrompt: "Configured visual evidence policy.",
        base64: Buffer.from("image-content").toString("base64"),
      }),
    );
    expect(output).toMatchObject({ answer: "visible evidence", model: "gpt-vision" });
  });

  it("rejects an image before reading it when the extension byte budget is exceeded", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-image-budget");
    temporaryDirectories.push(workspaceRoot);
    const upload = resolvedUpload(path.join(workspaceRoot, "missing.png"), 1_025);
    const complete = vi.spyOn(AgentImageVisionModelClient.prototype, "complete");
    const tool = createImageAnalyzeSystemTool({ input: { maxImageBytes: 1_024 } });

    await expect(
      tool.execute({ uploadUri: upload.manifest.uploadUri, task: "describe" }, hostContext(workspaceRoot, upload)),
    ).rejects.toMatchObject({
      messageKey: "vision.imageTooLarge",
      messageParams: { size: 1_025, maxImageBytes: 1_024 },
    });
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
      uploadId: "upload-1",
      uploadUri: "senera-upload://upload-1/image.png",
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
