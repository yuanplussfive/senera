import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parentPort } from "node:worker_threads";
import { createRastermill, type EncodedImage, type EncodedImageFormat, type ImageProbe } from "rastermill";
import isAnimated from "is-animated";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import {
  AgentImageNormalizationError,
  AgentImageNormalizationFailureCodes,
  AgentImageInputCapabilityViolations,
  matchesAgentImageInputCapabilities,
  normalizeAgentImageMime,
  resolveAgentImageInputCapabilityViolation,
  type AgentImageNormalizationFailureCode,
  type AgentImageInputCapabilities,
  type AgentImageNormalizationWorkerCancelRequest,
  type AgentImageNormalizationWorkerMessage,
  type AgentImageNormalizationWorkerRequest,
  type AgentImageNormalizationWorkerResponse,
} from "./AgentImageNormalizationService.js";

const port = parentPort ?? missingParentPort();
const require = createRequire(import.meta.url);
const MaximumSourcePixels = 100_000_000;
const rastermill = createRastermill({
  execution: "internal",
  limits: {
    // This is a process safety ceiling rather than a model policy. Model
    // limits are supplied per request and are enforced independently below.
    inputPixels: MaximumSourcePixels,
    outputPixels: MaximumSourcePixels,
  },
});
const queue: AgentImageNormalizationWorkerRequest[] = [];
const activeRequests = new Map<number, AbortController>();
let scheduled = false;
let pngOptimizer: Promise<(bytes: Buffer) => Promise<Buffer>> | undefined;

type CandidateKind = "original" | "lossless" | "constrained";

interface ImageCandidate {
  readonly kind: CandidateKind;
  readonly bytes: Buffer;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly animated: boolean;
  readonly sourceSha256: string;
  readonly policyKey: string;
  readonly derived: boolean;
}

interface ConstrainedCandidateResult {
  readonly candidates: readonly ImageCandidate[];
  /** True when a compatible encoder was reached, even if decoding failed. */
  readonly attemptedEncoding: boolean;
}

port.on("message", (message: AgentImageNormalizationWorkerMessage) => {
  if (message.type === "cancel") {
    removeQueuedRequest(message);
    activeRequests.get(message.requestId)?.abort("Image normalization was cancelled.");
    return;
  }
  queue.push(message);
  schedule();
});

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    void processNext();
  });
}

async function processNext(): Promise<void> {
  const request = queue.shift();
  if (!request) {
    scheduled = false;
    return;
  }
  const controller = new AbortController();
  activeRequests.set(request.requestId, controller);
  try {
    const image = await normalize(request, controller.signal);
    const bytes = toTransferableBytes(image.bytes, true);
    post(
      {
        type: "completed",
        requestId: request.requestId,
        image: {
          bytes,
          mime: image.mime,
          width: image.width,
          height: image.height,
          animated: image.animated,
          sourceSha256: image.sourceSha256,
          policyKey: image.policyKey,
          derived: image.derived,
        },
      },
      [bytes],
    );
  } catch (error) {
    post({ type: "failed", requestId: request.requestId, error: normalizeError(error) });
  } finally {
    activeRequests.delete(request.requestId);
  }
  setImmediate(() => {
    void processNext();
  });
}

/**
 * Selects only media that satisfies the model declaration. The canonical
 * upload is never changed. PNG may first receive a byte-preserving OxiPNG
 * pass; every lossy conversion is reserved for an incompatible transport or
 * an explicit model budget.
 */
async function normalize(request: AgentImageNormalizationWorkerRequest, signal: AbortSignal): Promise<ImageCandidate> {
  throwAbortReason(signal);
  const source = Buffer.from(request.input.bytes);
  assertSourceDigest(source, request.input.sourceSha256);
  const probe = await rastermill.probe(source);
  throwAbortReason(signal);
  if (!probe) {
    throw new AgentImageNormalizationError(
      AgentImageNormalizationFailureCodes.Unprocessable,
      "Image bytes could not be identified as a supported raster image.",
    );
  }
  const animated = isAnimatedImage(source);
  const sourceMime = sourceMimeForProbe(probe, request.input.mime, animated);
  const original: ImageCandidate = {
    kind: "original",
    bytes: source,
    mime: sourceMime,
    width: probe.width,
    height: probe.height,
    animated,
    sourceSha256: request.input.sourceSha256,
    policyKey: request.input.policyKey,
    derived: false,
  };

  if (animated) {
    return selectOriginalOrThrow(
      original,
      request.input.target,
      "Animated images are preserved as their original media and cannot be converted to a static derivative.",
    );
  }
  const lossless = await createLosslessPngCandidate(original, probe, request.input.target, signal);
  if (lossless && satisfiesTarget(lossless, request.input.target)) return lossless;
  if (satisfiesTarget(original, request.input.target)) return original;

  const constrained = await createConstrainedCandidates(original, probe, request.input.target, signal);
  const accepted = constrained.candidates.find((candidate) => satisfiesTarget(candidate, request.input.target));
  if (accepted) return accepted;

  throwNormalizationFailure(original, request.input.target, constrained.attemptedEncoding);
}

/** PNG optimization is byte-preserving by the codec's contract. */
async function createLosslessPngCandidate(
  original: ImageCandidate,
  probe: ImageProbe,
  target: AgentImageInputCapabilities,
  signal: AbortSignal,
): Promise<ImageCandidate | undefined> {
  if (original.mime !== "image/png" || !target.supportedMimeTypes.includes("image/png")) return undefined;
  throwAbortReason(signal);
  // OxiPNG decodes the pixel stream as well as inspecting its header. A
  // decode failure must not send a truncated original to the vision provider.
  const optimized = await optimizePng(original.bytes);
  throwAbortReason(signal);
  if (optimized.byteLength >= original.bytes.byteLength) return undefined;
  const optimizedProbe = await rastermill.probe(optimized);
  if (
    !optimizedProbe ||
    canonicalMimeForProbe(optimizedProbe) !== "image/png" ||
    optimizedProbe.width !== probe.width ||
    optimizedProbe.height !== probe.height
  ) {
    return undefined;
  }
  return {
    ...original,
    kind: "lossless",
    bytes: optimized,
    derived: true,
  };
}

async function createConstrainedCandidates(
  original: ImageCandidate,
  probe: ImageProbe,
  target: AgentImageInputCapabilities,
  signal: AbortSignal,
): Promise<ConstrainedCandidateResult> {
  const candidates: ImageCandidate[] = [];
  let attemptedEncoding = false;
  for (const format of constrainedFormatPlan(original.mime, target)) {
    throwAbortReason(signal);
    if (format === "jpeg" && !(await canEncodeJpegWithoutFlattening(original.bytes, probe, signal))) {
      continue;
    }
    attemptedEncoding = true;
    const encoded = await encodeConstrained(original, format, target, signal).catch(() => undefined);
    throwAbortReason(signal);
    if (!encoded) continue;
    candidates.push(encoded);
    // PNG is the sole format that preserves decoded pixels exactly. Once it
    // meets the model contract, lower-fidelity alternatives are unnecessary.
    if (format === "png" && satisfiesTarget(encoded, target)) return { candidates, attemptedEncoding };
  }
  return { candidates, attemptedEncoding };
}

/**
 * The ordering is a codec-fidelity policy, not provider behaviour. We first
 * seek a PNG result, then retain an already-compatible source codec, and only
 * then use lossy transport codecs to meet a declared restriction.
 */
function constrainedFormatPlan(sourceMime: string, target: AgentImageInputCapabilities): readonly EncodedImageFormat[] {
  const targetFormats = new Set(
    target.supportedMimeTypes.flatMap((mime) => {
      const format = encodedFormatForMime(mime);
      return format ? [format] : [];
    }),
  );
  const sourceFormat = encodedFormatForMime(sourceMime);
  const ordered: EncodedImageFormat[] = [];
  const add = (format: EncodedImageFormat): void => {
    if (targetFormats.has(format) && !ordered.includes(format)) ordered.push(format);
  };

  add("png");
  if (sourceFormat) add(sourceFormat);
  add("jpeg");
  add("webp");
  return ordered;
}

async function encodeConstrained(
  original: ImageCandidate,
  format: EncodedImageFormat,
  target: AgentImageInputCapabilities,
  signal: AbortSignal,
): Promise<ImageCandidate | undefined> {
  const limits = target.maxPixels === undefined ? undefined : { maxPixels: target.maxPixels };
  const common = {
    metadata: "strip" as const,
    ...(target.maxBytes === undefined ? {} : { maxBytes: target.maxBytes }),
    ...(limits === undefined ? {} : { limits }),
    signal,
  };
  let encoded: EncodedImage;
  switch (format) {
    case "png":
      encoded = await rastermill.encode(original.bytes, { format, compressionLevel: 9, ...common });
      break;
    case "jpeg":
      encoded = await rastermill.encode(original.bytes, { format, ...common });
      break;
    case "webp":
      encoded = await rastermill.encode(original.bytes, { format, ...common });
      break;
  }
  if (encoded.withinBudget === false) return undefined;
  return {
    kind: "constrained",
    bytes: encoded.data,
    mime: encoded.mimeType,
    width: encoded.width,
    height: encoded.height,
    animated: false,
    sourceSha256: original.sourceSha256,
    policyKey: original.policyKey,
    derived: true,
  };
}

async function canEncodeJpegWithoutFlattening(
  source: Buffer,
  probe: ImageProbe,
  signal: AbortSignal,
): Promise<boolean> {
  if (probe.hasAlpha === false) return true;
  throwAbortReason(signal);
  const transparency = await rastermill.transparency(source).catch(() => undefined);
  throwAbortReason(signal);
  return transparency?.hasTransparentPixels === false;
}

function selectOriginalOrThrow(
  original: ImageCandidate,
  target: AgentImageInputCapabilities,
  message: string,
): ImageCandidate {
  if (satisfiesTarget(original, target)) return original;
  throwNormalizationFailure(original, target, false, message);
}

function throwNormalizationFailure(
  original: ImageCandidate,
  target: AgentImageInputCapabilities,
  attemptedEncoding: boolean,
  message?: string,
): never {
  const violation = resolveAgentImageInputCapabilityViolation(
    {
      mime: original.mime,
      byteLength: original.bytes.byteLength,
      width: original.width,
      height: original.height,
      animated: original.animated,
    },
    target,
  );
  if (
    violation === AgentImageInputCapabilityViolations.ByteLimitExceeded ||
    violation === AgentImageInputCapabilityViolations.PixelLimitExceeded
  ) {
    throw new AgentImageNormalizationError(
      AgentImageNormalizationFailureCodes.BudgetExceeded,
      message ?? "No valid image derivative fits the configured model input budget.",
    );
  }
  if (
    violation === AgentImageInputCapabilityViolations.AnimatedNotSupported ||
    (violation === AgentImageInputCapabilityViolations.UnsupportedMime && !hasEncodableTarget(target))
  ) {
    throw new AgentImageNormalizationError(
      AgentImageNormalizationFailureCodes.Unsupported,
      message ?? `The configured model does not accept ${original.mime} image input.`,
    );
  }
  throw new AgentImageNormalizationError(
    attemptedEncoding
      ? AgentImageNormalizationFailureCodes.Unprocessable
      : AgentImageNormalizationFailureCodes.Unsupported,
    message ?? "The configured model does not accept a compatible static image transport.",
  );
}

function hasEncodableTarget(target: AgentImageInputCapabilities): boolean {
  return target.supportedMimeTypes.some((mime) => encodedFormatForMime(mime) !== undefined);
}

function satisfiesTarget(
  image: Pick<ImageCandidate, "mime" | "bytes" | "width" | "height" | "animated">,
  target: AgentImageInputCapabilities,
): boolean {
  return matchesAgentImageInputCapabilities(
    {
      mime: image.mime,
      byteLength: image.bytes.byteLength,
      width: image.width,
      height: image.height,
      animated: image.animated,
    },
    target,
  );
}

function sourceMimeForProbe(probe: ImageProbe, suppliedMime: string, animated: boolean): string {
  const supplied = normalizeAgentImageMime(suppliedMime);
  if (supplied && isMimeForProbe(supplied, probe, animated)) return supplied;
  return canonicalMimeForProbe(probe, animated);
}

function isMimeForProbe(mime: string, probe: ImageProbe, animated: boolean): boolean {
  if (mime === canonicalMimeForProbe(probe, animated)) return true;
  // HEIC is a HEIF-family container but has its own registered MIME type.
  return probe.format === "heif" && mime === "image/heic";
}

function canonicalMimeForProbe(probe: ImageProbe, animated = false): string {
  switch (probe.format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return animated ? "image/apng" : "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "tiff":
      return "image/tiff";
    case "heif":
      return "image/heif";
    case "bmp":
      return "image/bmp";
  }
}

function encodedFormatForMime(mime: string): EncodedImageFormat | undefined {
  switch (mime) {
    case "image/jpeg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return undefined;
  }
}

function isAnimatedImage(bytes: Buffer): boolean {
  try {
    return isAnimated(bytes);
  } catch (error) {
    throw new AgentImageNormalizationError(
      AgentImageNormalizationFailureCodes.Unprocessable,
      `Image animation state could not be determined: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertSourceDigest(bytes: Buffer, expected: string): void {
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new AgentImageNormalizationError(
      AgentImageNormalizationFailureCodes.Unprocessable,
      "Image bytes do not match the source integrity digest.",
    );
  }
}

async function optimizePng(bytes: Buffer): Promise<Buffer> {
  const optimize = await loadPngOptimizer();
  return optimize(bytes);
}

function loadPngOptimizer(): Promise<(bytes: Buffer) => Promise<Buffer>> {
  pngOptimizer ??= createPngOptimizer();
  return pngOptimizer;
}

async function createPngOptimizer(): Promise<(bytes: Buffer) => Promise<Buffer>> {
  const codecPath = require.resolve("@jsquash/oxipng/codec/pkg/squoosh_oxipng.js");
  const wasmPath = require.resolve("@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm");
  const codec = await import(pathToFileURL(codecPath).href);
  const wasm = await fs.readFile(wasmPath);
  await codec.default(toTransferableBytes(wasm));
  return async (bytes) => Buffer.from(codec.optimise(new Uint8Array(bytes), 4, false, false));
}

function removeQueuedRequest(message: AgentImageNormalizationWorkerCancelRequest): void {
  const index = queue.findIndex((request) => request.requestId === message.requestId);
  if (index >= 0) queue.splice(index, 1);
}

function normalizeError(error: unknown): {
  readonly code: AgentImageNormalizationFailureCode;
  readonly message: string;
} {
  if (error instanceof AgentImageNormalizationError) return { code: error.code, message: error.message };
  return {
    code: AgentImageNormalizationFailureCodes.Unprocessable,
    message: error instanceof Error ? error.message : String(error),
  };
}

function post(message: AgentImageNormalizationWorkerResponse, transferList?: ArrayBuffer[]): void {
  if (transferList) port.postMessage(message, transferList);
  else port.postMessage(message);
}

function toTransferableBytes(bytes: Uint8Array, transferOwnership = false): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    if (transferOwnership && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
      return bytes.buffer;
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function missingParentPort(): never {
  throw new Error("Image normalization worker requires parentPort.");
}
