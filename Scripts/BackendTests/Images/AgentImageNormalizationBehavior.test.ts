import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { deflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { encodePngRgba } from "rastermill";
import { resolveUploadsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import {
  AgentImageNormalizationFailureCodes,
  AgentImageNormalizationPolicyRevision,
  AgentImageNormalizationService,
  createAgentImageNormalizationPolicyKey,
  type AgentImageInputCapabilities,
} from "../../../Source/AgentSystem/Images/AgentImageNormalizationService.js";
import { AgentUploadFileNames } from "../../../Source/AgentSystem/Uploads/AgentUploadLocator.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import { createAgentUploadImageAnalysisFileName } from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";

const services: AgentImageNormalizationService[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("image normalization behavior", () => {
  test("rejects truncated PNG data even when the model accepts the original format", async () => {
    const service = createService();
    const source = createOpaquePng(64, 64, 0);
    const truncated = source.subarray(0, Math.floor(source.length / 2));
    const target = imageTarget(["image/png"]);
    await expect(service.normalize(normalizationInput(truncated, target))).rejects.toMatchObject({
      code: AgentImageNormalizationFailureCodes.Unprocessable,
    });
    // A failed decode must not poison the shared worker for later valid images.
    await expect(service.normalize(normalizationInput(source, target))).resolves.toMatchObject({ mime: "image/png" });
  });

  test("uses an OxiPNG derivative when it is byte-preserving and smaller than an otherwise compatible source", async () => {
    const service = createService();
    const source = createOpaquePng(64, 64, 0);
    const target = imageTarget(["image/png"]);

    const image = await service.normalize(normalizationInput(source, target));

    expect(image).toMatchObject({ mime: "image/png", width: 64, height: 64, derived: true });
    expect(image.bytes.byteLength).toBeLessThan(source.byteLength);
  });

  test("copies a shared source buffer before crossing the Worker boundary", async () => {
    const service = createService();
    const source = createOpaquePng(32, 32, 9);
    const shared = new Uint8Array(new SharedArrayBuffer(source.byteLength));
    shared.set(source);

    const image = await service.normalize({
      bytes: shared,
      mime: "image/png",
      sourceSha256: crypto.createHash("sha256").update(shared).digest("hex"),
      target: imageTarget(["image/png"]),
      transferSource: true,
    });

    expect(image).toMatchObject({ mime: "image/png" });
    expect(Buffer.from(shared)).toEqual(source);
  });

  test("uses a lossless PNG derivative only when its declared byte budget requires one", async () => {
    const service = createService();
    const source = createOpaquePng(64, 64, 0);
    const target = imageTarget(["image/png"], { maxBytes: 1_000 });

    const image = await service.normalize(normalizationInput(source, target));

    expect(source.byteLength).toBeGreaterThan(target.maxBytes!);
    expect(image).toMatchObject({ mime: "image/png", width: 64, height: 64, derived: true });
    expect(image.bytes.byteLength).toBeLessThanOrEqual(target.maxBytes!);
    expect(image.bytes).not.toEqual(source);
  });

  test("converts and resizes opaque static media only to a supported transport", async () => {
    const service = createService();
    const source = createOpaquePng(32, 32, 9);
    const target = imageTarget(["image/jpeg"], { maxPixels: 64, maxBytes: 2_000 });

    const image = await service.normalize(normalizationInput(source, target));

    expect(image).toMatchObject({ mime: "image/jpeg", derived: true });
    expect(image.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(image.width! * image.height!).toBeLessThanOrEqual(target.maxPixels!);
    expect(image.bytes.byteLength).toBeLessThanOrEqual(target.maxBytes!);
  });

  test("converts a static image to WebP when that is the declared transport", async () => {
    const service = createService();
    const source = createOpaquePng(32, 32, 9);

    const image = await service.normalize(normalizationInput(source, imageTarget(["image/webp"])));

    expect(image).toMatchObject({ mime: "image/webp", width: 32, height: 32, derived: true });
    expect(image.bytes.subarray(0, 4)).toEqual(Buffer.from("RIFF"));
    expect(image.bytes.subarray(8, 12)).toEqual(Buffer.from("WEBP"));
  });

  test("does not flatten transparent media into JPEG", async () => {
    const service = createService();
    const source = createTransparentPng();

    await expect(service.normalize(normalizationInput(source, imageTarget(["image/jpeg"])))).rejects.toMatchObject({
      code: AgentImageNormalizationFailureCodes.Unsupported,
    });
  });

  test("preserves animation as source media and rejects an incompatible static-only contract", async () => {
    const service = createService();
    const source = animatedGif();

    await expect(
      service.normalize(
        normalizationInput(source, imageTarget(["image/gif"], { supportedAnimatedMimeTypes: ["image/gif"] })),
      ),
    ).resolves.toMatchObject({
      mime: "image/gif",
      animated: true,
      derived: false,
      bytes: source,
    });
    await expect(service.normalize(normalizationInput(source, imageTarget(["image/jpeg"])))).rejects.toMatchObject({
      code: AgentImageNormalizationFailureCodes.Unsupported,
    });
  });

  test("does not assume animated GIF support from the portable static contract", async () => {
    const service = createService();
    const source = animatedGif();

    await expect(
      service.normalize(normalizationInput(source, imageTarget(["image/jpeg", "image/png", "image/webp"]))),
    ).rejects.toMatchObject({ code: AgentImageNormalizationFailureCodes.Unsupported });
  });

  test("does not treat APNG as static PNG unless the model explicitly declares image/apng animation support", async () => {
    const service = createService();
    const source = animatedApng();

    await expect(
      service.normalize(normalizationInput(source, imageTarget(["image/jpeg", "image/png", "image/webp"]))),
    ).rejects.toMatchObject({ code: AgentImageNormalizationFailureCodes.Unsupported });

    await expect(
      service.normalize(
        normalizationInput(source, imageTarget(["image/apng"], { supportedAnimatedMimeTypes: ["image/apng"] })),
      ),
    ).resolves.toMatchObject({ mime: "image/apng", animated: true, derived: false, bytes: source });
  });

  test("includes declared animation support in the derivative-cache policy key", () => {
    const staticTarget = imageTarget(["image/webp"]);
    const animatedTarget = imageTarget(["image/webp"], { supportedAnimatedMimeTypes: ["image/webp"] });

    expect(createAgentImageNormalizationPolicyKey(animatedTarget)).not.toBe(
      createAgentImageNormalizationPolicyKey(staticTarget),
    );
  });

  test("keeps an allowed animated upload as its verified original rather than creating a static analysis cache", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-animated-upload-"));
    temporaryRoots.push(workspaceRoot);
    const store = new AgentUploadStore({
      workspaceRoot,
      config: resolveUploadsConfig({ ModelProviders: [] }),
    });
    const source = animatedApng();
    const attachment = await store.save({
      stream: Readable.from([source]),
      originalName: "animation.png",
      declaredMime: "image/png",
    });
    const image = await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target: imageTarget(["image/apng"], { supportedAnimatedMimeTypes: ["image/apng"] }),
      normalizer: createService(),
    });

    expect(image).toMatchObject({ mime: "image/apng", animated: true, derived: false, bytes: source });
    expect((await store.resolve(attachment.resourceUri))?.manifest.imageAnalysis).toBeUndefined();
  });

  test("reports damaged static data as unprocessable instead of an unsupported transport", async () => {
    const service = createService();
    // The PNG signature and header probe correctly, but its compressed image
    // data cannot be decoded into another static transport.
    const source = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+SgWp0wAAAABJRU5ErkJggg==",
      "base64",
    );

    await expect(service.normalize(normalizationInput(source, imageTarget(["image/webp"])))).rejects.toMatchObject({
      code: AgentImageNormalizationFailureCodes.Unprocessable,
    });
  });

  test("reuses a valid upload derivative and regenerates a corrupted cache asset", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-image-normalization-"));
    temporaryRoots.push(workspaceRoot);
    const store = new AgentUploadStore({
      workspaceRoot,
      config: resolveUploadsConfig({ ModelProviders: [] }),
    });
    const source = createOpaquePng(32, 32, 9);
    const attachment = await store.save({
      stream: Readable.from([source]),
      originalName: "source.png",
      declaredMime: "image/png",
    });
    const service = createService();
    const normalize = vi.fn((input) => service.normalize(input));
    const target = imageTarget(["image/jpeg"], { maxPixels: 64, maxBytes: 2_000 });

    const first = await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target,
      normalizer: { normalize },
    });
    const second = await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target,
      normalizer: { normalize },
    });

    expect(first).toMatchObject({ mime: "image/jpeg", derived: true });
    expect(second?.bytes).toEqual(first?.bytes);
    expect(normalize).toHaveBeenCalledTimes(1);

    const resolved = await store.resolve(attachment.resourceUri);
    const asset = resolved?.manifest.imageAnalysis?.[0];
    expect(asset).toBeDefined();
    expect(asset?.fileName).toBe(
      createAgentUploadImageAnalysisFileName({
        policyKey: asset!.policyKey,
        sha256: asset!.sha256,
        mime: asset!.mime,
      }),
    );
    const assetPath = path.join(resolved!.uploadDir, asset!.fileName);
    await fs.writeFile(assetPath, Buffer.alloc(asset!.size));

    const regenerated = await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target,
      normalizer: { normalize },
    });

    expect(regenerated?.bytes).toEqual(first?.bytes);
    expect(normalize).toHaveBeenCalledTimes(2);
  });

  test("retires stale normalization revisions while retaining current policy variants", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-image-normalization-"));
    temporaryRoots.push(workspaceRoot);
    const store = new AgentUploadStore({
      workspaceRoot,
      config: resolveUploadsConfig({ ModelProviders: [] }),
    });
    const source = createOpaquePng(32, 32, 9);
    const attachment = await store.save({
      stream: Readable.from([source]),
      originalName: "source.png",
      declaredMime: "image/png",
    });
    const service = createService();
    await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target: imageTarget(["image/jpeg"]),
      normalizer: service,
    });

    const resolved = await store.resolve(attachment.resourceUri);
    expect(resolved).toBeDefined();
    const legacyBytes = Buffer.from("legacy image-analysis cache");
    const legacyPolicyKey = "a".repeat(64);
    const legacySha256 = crypto.createHash("sha256").update(legacyBytes).digest("hex");
    const legacyAsset = {
      policyRevision: "static-raster-v3",
      policyKey: legacyPolicyKey,
      sourceSha256: resolved!.manifest.sha256,
      fileName: createAgentUploadImageAnalysisFileName({
        policyKey: legacyPolicyKey,
        sha256: legacySha256,
        mime: "image/jpeg",
      }),
      mime: "image/jpeg" as const,
      size: legacyBytes.byteLength,
      sha256: legacySha256,
      width: 1,
      height: 1,
    };
    const legacyPath = path.join(resolved!.uploadDir, legacyAsset.fileName);
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, legacyBytes);
    await fs.writeFile(
      path.join(resolved!.uploadDir, AgentUploadFileNames.Manifest),
      `${JSON.stringify({
        ...resolved!.manifest,
        imageAnalysis: [...(resolved!.manifest.imageAnalysis ?? []), legacyAsset],
      })}\n`,
    );

    await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target: imageTarget(["image/webp"]),
      normalizer: service,
    });

    const refreshed = await store.resolve(attachment.resourceUri);
    expect(refreshed?.manifest.imageAnalysis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ policyRevision: AgentImageNormalizationPolicyRevision, mime: "image/jpeg" }),
        expect.objectContaining({ policyRevision: AgentImageNormalizationPolicyRevision, mime: "image/webp" }),
      ]),
    );
    expect(refreshed?.manifest.imageAnalysis).toHaveLength(2);
    await expect(fs.stat(legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps the canonical upload intact when a compatible PNG receives a lossless delivery derivative", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-image-normalization-"));
    temporaryRoots.push(workspaceRoot);
    const store = new AgentUploadStore({
      workspaceRoot,
      config: resolveUploadsConfig({ ModelProviders: [] }),
    });
    const source = createOpaquePng(32, 32, 9);
    const attachment = await store.save({
      stream: Readable.from([source]),
      originalName: "source.png",
      declaredMime: "image/png",
    });
    const service = createService();

    const resolved = await store.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target: imageTarget(["image/png"]),
      normalizer: service,
    });

    expect(resolved).toMatchObject({ mime: "image/png", derived: true });
    expect(resolved?.bytes.byteLength).toBeLessThan(source.byteLength);
    const canonical = await store.resolve(attachment.resourceUri);
    await expect(fs.readFile(canonical!.filePath)).resolves.toEqual(source);
  });

  test("stops accepting work after its worker runtime is closed", async () => {
    const service = createService();
    await service.close();
    const source = createOpaquePng(1, 1, 9);

    await expect(service.normalize(normalizationInput(source, imageTarget(["image/png"])))).rejects.toThrow(
      "Image normalization service is closed.",
    );
  });
});

function createService(): AgentImageNormalizationService {
  const service = new AgentImageNormalizationService();
  services.push(service);
  return service;
}

function normalizationInput(bytes: Buffer, target: AgentImageInputCapabilities) {
  return {
    bytes,
    mime: "image/png",
    sourceSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    target,
  };
}

function imageTarget(
  supportedMimeTypes: readonly string[],
  limits: Omit<AgentImageInputCapabilities, "supportedMimeTypes"> = {},
): AgentImageInputCapabilities {
  return { supportedMimeTypes, ...limits };
}

function createOpaquePng(width: number, height: number, compressionLevel: number): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.byteLength; index += 4) {
    pixels[index] = index % 251;
    pixels[index + 1] = (index * 3) % 251;
    pixels[index + 2] = (index * 7) % 251;
    pixels[index + 3] = 255;
  }
  return encodePngRgba(pixels, width, height, compressionLevel);
}

function createTransparentPng(): Buffer {
  const pixels = Buffer.alloc(4 * 4 * 4, 255);
  pixels[3] = 0;
  return encodePngRgba(pixels, 4, 4, 9);
}

function animatedGif(): Buffer {
  return Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAAh+QQBAAAAACwAAAAAAQABAAACAUQAOw==",
    "base64",
  );
}

/** A two-frame 1x1 APNG with a valid first-frame PNG stream. */
function animatedApng(): Buffer {
  const source = createOpaquePng(1, 1, 9);
  const chunks = readPngChunks(source);
  const signature = source.subarray(0, 8);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  const idat = chunks.find((chunk) => chunk.type === "IDAT");
  const iend = chunks.find((chunk) => chunk.type === "IEND");
  if (!ihdr || !idat || !iend) throw new Error("PNG fixture is missing a required chunk.");

  return Buffer.concat([
    signature,
    ihdr.bytes,
    pngChunk("acTL", Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])),
    pngChunk("fcTL", apngFrameControl(0)),
    idat.bytes,
    pngChunk("fcTL", apngFrameControl(1)),
    pngChunk("fdAT", Buffer.concat([Buffer.from([0, 0, 0, 2]), deflateSync(Buffer.from([0, 0, 255, 0, 255]))])),
    iend.bytes,
  ]);
}

function apngFrameControl(sequence: number): Buffer {
  const control = Buffer.alloc(26);
  control.writeUInt32BE(sequence, 0);
  control.writeUInt32BE(1, 4);
  control.writeUInt32BE(1, 8);
  control.writeUInt16BE(1, 20);
  control.writeUInt16BE(10, 22);
  return control;
}

function readPngChunks(bytes: Buffer): Array<{ type: string; bytes: Buffer }> {
  const chunks: Array<{ type: string; bytes: Buffer }> = [];
  for (let offset = 8; offset < bytes.byteLength;) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    chunks.push({ type, bytes: bytes.subarray(offset, end) });
    offset = end;
  }
  return chunks;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength, 0);
  header.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), payload])), 0);
  return Buffer.concat([header, payload, crc]);
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) === 0 ? 0 : 0xedb88320);
  }
  return (value ^ 0xffffffff) >>> 0;
}
