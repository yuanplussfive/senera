import { describe, expect, test, vi } from "vitest";
import { projectAgentPiImageAttachments } from "../../../Source/AgentSystem/Pi/AgentPiImageAttachmentProjector.js";
import type { AgentPiModelProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { AgentUploadAttachment } from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";
import type { AgentResolvedUploadImage } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";

describe("Pi image attachment projection", () => {
  test("projects an uploaded image through the shared model-image boundary", async () => {
    const fixture = createImageFixture();
    const resolveImageForModel = vi.fn(async () => fixture.image);

    await expect(
      projectAgentPiImageAttachments({
        attachments: [fixture.attachment],
        model: nativeVisionModel(),
        uploadStore: { resolveImageForModel },
        imageNormalization: { normalize: vi.fn() },
        imageInputCapabilities: imageInputCapabilities(),
      }),
    ).resolves.toEqual([
      {
        type: "image",
        data: fixture.bytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(resolveImageForModel).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceUri: fixture.attachment.resourceUri,
        target: imageInputCapabilities(),
      }),
    );
  });

  test("does not read resources for a text-only model", async () => {
    const resolveImageForModel = vi.fn();

    await expect(
      projectAgentPiImageAttachments({
        attachments: [imageAttachment()],
        model: textOnlyModel(),
        uploadStore: { resolveImageForModel },
      }),
    ).resolves.toEqual([]);
    expect(resolveImageForModel).not.toHaveBeenCalled();
  });

  test("keeps vector resources on the file-reference path", async () => {
    const resolveImageForModel = vi.fn();

    await expect(
      projectAgentPiImageAttachments({
        attachments: [{ ...imageAttachment(), name: "logo.svg", mime: "image/svg+xml" }],
        model: nativeVisionModel(),
        uploadStore: { resolveImageForModel },
        imageNormalization: { normalize: vi.fn() },
        imageInputCapabilities: imageInputCapabilities(),
      }),
    ).resolves.toEqual([]);
    expect(resolveImageForModel).not.toHaveBeenCalled();
  });

  test("normalizes a non-browser raster source before native vision projection", async () => {
    const fixture = createImageFixture();
    const resolveImageForModel = vi.fn(async () => fixture.image);

    await expect(
      projectAgentPiImageAttachments({
        attachments: [{ ...fixture.attachment, name: "capture.heic", mime: "image/heic" }],
        model: nativeVisionModel(),
        uploadStore: { resolveImageForModel },
        imageNormalization: { normalize: vi.fn() },
        imageInputCapabilities: imageInputCapabilities(),
      }),
    ).resolves.toEqual([
      {
        type: "image",
        data: fixture.bytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(resolveImageForModel).toHaveBeenCalledWith(
      expect.objectContaining({ resourceUri: fixture.attachment.resourceUri }),
    );
  });

  test("resolves only the current turn image because Pi owns native history", async () => {
    const fixture = createImageFixture();
    const resolveImageForModel = vi.fn(async () => fixture.image);

    const images = await projectAgentPiImageAttachments({
      attachments: [fixture.attachment],
      model: nativeVisionModel(),
      uploadStore: { resolveImageForModel },
      imageNormalization: { normalize: vi.fn() },
      imageInputCapabilities: imageInputCapabilities(),
    });

    expect(images).toEqual([{ type: "image", data: fixture.bytes.toString("base64"), mimeType: "image/png" }]);
    expect(resolveImageForModel).toHaveBeenCalledTimes(1);
  });
});

function createImageFixture(): {
  bytes: Buffer;
  attachment: AgentUploadAttachment;
  image: AgentResolvedUploadImage;
} {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const attachment = imageAttachment();
  return {
    bytes,
    attachment,
    image: {
      resourceUri: attachment.resourceUri,
      name: attachment.name,
      mime: attachment.mime,
      size: bytes.byteLength,
      sha256: "a".repeat(64),
      animated: false,
      bytes,
      derived: false,
    },
  };
}

function imageInputCapabilities() {
  return { supportedMimeTypes: ["image/png"] };
}

function imageAttachment(): AgentUploadAttachment {
  return {
    resourceUri: "senera://resource/upl_image_fixture",
    name: "image.png",
    mime: "image/png",
    size: 8,
    status: "uploaded",
  };
}

function nativeVisionModel(): AgentPiModelProjection {
  return {
    id: "vision-model",
    name: "Vision model",
    api: "openai-completions",
    provider: "test-provider",
    baseUrl: "https://model.example/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function textOnlyModel(): AgentPiModelProjection {
  return { ...nativeVisionModel(), input: ["text"] };
}
