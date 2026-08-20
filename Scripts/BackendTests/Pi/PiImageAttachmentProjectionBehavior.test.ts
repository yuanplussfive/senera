import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentPiConversationProjector } from "../../../Source/AgentSystem/Pi/AgentPiConversationProjector.js";
import { projectAgentPiImageAttachments } from "../../../Source/AgentSystem/Pi/AgentPiImageAttachmentProjector.js";
import type { AgentPiModelProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type {
  AgentResolvedUpload,
  AgentUploadAttachment,
  AgentUploadManifest,
} from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Pi image attachment projection", () => {
  test("projects an uploaded image as native ImageContent while retaining the resource lookup", async () => {
    const fixture = await createImageFixture();
    const resolve = vi.fn(async () => fixture.upload);

    await expect(
      projectAgentPiImageAttachments({
        attachments: [fixture.attachment],
        model: nativeVisionModel(),
        uploadStore: { resolve },
      }),
    ).resolves.toEqual([
      {
        type: "image",
        data: fixture.bytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(resolve).toHaveBeenCalledWith(fixture.attachment.resourceUri);
  });

  test("does not read resources for a text-only model", async () => {
    const resolve = vi.fn();

    await expect(
      projectAgentPiImageAttachments({
        attachments: [imageAttachment()],
        model: textOnlyModel(),
        uploadStore: { resolve },
      }),
    ).resolves.toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("projects current and historical images through the same conversation path", async () => {
    const fixture = await createImageFixture();
    const conversation = new AgentConversationProjector();
    const previous = conversation.projectUserInput(
      "previous-request",
      "What is in the earlier image?",
      "2026-01-01T00:00:00.000Z",
      undefined,
      [fixture.attachment],
    );
    const current = conversation.projectUserInput(
      "current-request",
      "Compare this image with the earlier one.",
      "2026-01-01T00:01:00.000Z",
      undefined,
      [fixture.attachment],
    );
    const resolve = vi.fn(async () => fixture.upload);

    const projection = await new AgentPiConversationProjector().projectWithImages({
      requestId: current.requestId,
      userInput: current.content,
      conversationEntries: [previous, current],
      model: nativeVisionModel(),
      currentAttachments: current.attachments,
      uploadStore: { resolve },
    });

    expect(projection.images).toEqual([
      { type: "image", data: fixture.bytes.toString("base64"), mimeType: "image/png" },
    ]);
    expect(projection.history).toHaveLength(1);
    expect(projection.history[0]).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "image", data: fixture.bytes.toString("base64"), mimeType: "image/png" }],
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

async function createImageFixture(): Promise<{
  bytes: Buffer;
  attachment: AgentUploadAttachment;
  upload: AgentResolvedUpload;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-pi-image-"));
  temporaryRoots.push(root);
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const filePath = path.join(root, "image.png");
  await fs.writeFile(filePath, bytes);
  const attachment = imageAttachment();
  const manifest: AgentUploadManifest = {
    resourceId: "upl_image_fixture",
    resourceUri: attachment.resourceUri,
    name: attachment.name,
    mime: "image/png",
    size: bytes.byteLength,
    sha256: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    storage: { fileName: "original" },
  };
  return {
    bytes,
    attachment,
    upload: { manifest, filePath, uploadDir: root },
  };
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
