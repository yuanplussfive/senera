import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import {
  resolveAgentWorkerThreadData,
  resolveAgentWorkerThreadEntry,
  resolveAgentWorkerThreadExecArgv,
} from "../Core/AgentWorkerThread.js";

/**
 * Portable, non-animated image transport baseline. A model declaration can
 * extend or narrow this set when its endpoint publishes a more specific media
 * contract.
 *
 * Animated GIF and HEIC/HEIF deliberately do not appear here: their handling
 * differs across otherwise compatible endpoints and must be declared by the
 * endpoint owner rather than inferred from provider identity.
 */
export const AgentPortableStaticVisionInputMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Raster source formats the shared boundary can inspect before delivery.
 * This is intentionally broader than the local transcoder's codec set: a
 * model that explicitly accepts one of these source formats can receive its
 * verified original bytes even when the local worker cannot transcode it.
 */
export const AgentNormalizableRasterImageMimeTypes = [
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
] as const;

const AgentNormalizableRasterImageMimeTypeSet: ReadonlySet<string> = new Set(AgentNormalizableRasterImageMimeTypes);

/** Bump only when the candidate-generation or selection semantics change. */
export const AgentImageNormalizationPolicyRevision = "static-raster-v5";

export interface AgentImageInputCapabilities {
  readonly supportedMimeTypes: readonly string[];
  /** Animated delivery is opt-in even when its MIME is otherwise accepted. */
  readonly supportedAnimatedMimeTypes?: readonly string[];
  readonly maxBytes?: number;
  readonly maxPixels?: number;
}

export interface AgentImageInputDescriptor {
  readonly mime: string;
  readonly byteLength: number;
  readonly width?: number;
  readonly height?: number;
  readonly animated: boolean;
}

export const AgentImageInputCapabilityViolations = {
  UnsupportedMime: "unsupported_mime",
  AnimatedNotSupported: "animated_not_supported",
  ByteLimitExceeded: "byte_limit_exceeded",
  PixelLimitExceeded: "pixel_limit_exceeded",
} as const;

export type AgentImageInputCapabilityViolation =
  (typeof AgentImageInputCapabilityViolations)[keyof typeof AgentImageInputCapabilityViolations];

export interface AgentImageNormalizationInput {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly sourceSha256: string;
  readonly target: AgentImageInputCapabilities;
  /** Transfers a dedicated source buffer into the worker when the caller no longer needs it. */
  readonly transferSource?: boolean;
  readonly signal?: AbortSignal;
}

export interface AgentNormalizedImage {
  readonly bytes: Buffer;
  readonly mime: string;
  readonly width?: number;
  readonly height?: number;
  readonly animated: boolean;
  readonly sourceSha256: string;
  readonly policyKey: string;
  readonly derived: boolean;
}

export const AgentImageNormalizationFailureCodes = {
  BudgetExceeded: "image_input_budget_exceeded",
  Unsupported: "image_input_unsupported",
  Unprocessable: "image_input_unprocessable",
} as const;

export type AgentImageNormalizationFailureCode =
  (typeof AgentImageNormalizationFailureCodes)[keyof typeof AgentImageNormalizationFailureCodes];

export class AgentImageNormalizationError extends Error {
  constructor(
    readonly code: AgentImageNormalizationFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentImageNormalizationError";
  }
}

export interface AgentImageNormalizationWorkerRequest {
  readonly type: "normalize";
  readonly requestId: number;
  readonly input: {
    readonly bytes: ArrayBuffer;
    readonly mime: string;
    readonly sourceSha256: string;
    readonly target: AgentImageInputCapabilities;
    readonly policyKey: string;
  };
}

export interface AgentImageNormalizationWorkerCancelRequest {
  readonly type: "cancel";
  readonly requestId: number;
}

export type AgentImageNormalizationWorkerMessage =
  AgentImageNormalizationWorkerRequest | AgentImageNormalizationWorkerCancelRequest;

export interface AgentImageNormalizationWorkerCompletedResponse {
  readonly type: "completed";
  readonly requestId: number;
  readonly image: {
    readonly bytes: ArrayBuffer;
    readonly mime: string;
    readonly width?: number;
    readonly height?: number;
    readonly animated: boolean;
    readonly sourceSha256: string;
    readonly policyKey: string;
    readonly derived: boolean;
  };
}

export interface AgentImageNormalizationWorkerFailedResponse {
  readonly type: "failed";
  readonly requestId: number;
  readonly error: {
    readonly code: AgentImageNormalizationFailureCode;
    readonly message: string;
  };
}

export type AgentImageNormalizationWorkerResponse =
  AgentImageNormalizationWorkerCompletedResponse | AgentImageNormalizationWorkerFailedResponse;

interface PendingNormalization {
  readonly resolve: (image: AgentNormalizedImage) => void;
  readonly reject: (error: unknown) => void;
  readonly unbind: () => void;
}

/**
 * One worker-backed image boundary shared by uploads and visual model calls.
 * Codec work never runs on Electron's UI/main thread and no source bytes are
 * retained after a request has settled.
 */
export class AgentImageNormalizationService {
  private worker: Worker | undefined;
  private closePromise: Promise<void> | undefined;
  private terminalError: Error | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingNormalization>();

  normalize(input: AgentImageNormalizationInput): Promise<AgentNormalizedImage> {
    throwAbortReason(input.signal);
    if (this.closePromise) return Promise.reject(new Error("Image normalization service is closed."));
    if (this.terminalError) return Promise.reject(this.terminalError);

    const target = normalizeImageInputCapabilities(input.target);
    const mime = normalizeAgentImageMime(input.mime);
    if (!mime) throw new TypeError("Image MIME type is required.");
    if (!isSha256(input.sourceSha256))
      throw new TypeError("Image source SHA-256 must be a lowercase hexadecimal digest.");

    const requestId = this.nextRequestId++;
    const bytes = toTransferableBytes(input.bytes, input.transferSource === true);
    const policyKey = createAgentImageNormalizationPolicyKey(target);
    const request: AgentImageNormalizationWorkerRequest = {
      type: "normalize",
      requestId,
      input: {
        bytes,
        mime,
        sourceSha256: input.sourceSha256,
        target,
        policyKey,
      },
    };
    const worker = this.ensureWorker();

    return new Promise<AgentNormalizedImage>((resolve, reject) => {
      let settled = false;
      const unbind = (): void => input.signal?.removeEventListener("abort", cancel);
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        const pending = this.pending.get(requestId);
        this.pending.delete(requestId);
        pending?.unbind();
        callback();
      };
      const cancel = (): void =>
        settle(() => {
          try {
            worker.postMessage({ type: "cancel", requestId } satisfies AgentImageNormalizationWorkerCancelRequest);
          } catch {
            // The worker's normal shutdown path rejects any other queued work.
          }
          try {
            throwAbortReason(input.signal);
          } catch (error) {
            reject(error);
          }
        });
      this.pending.set(requestId, { resolve, reject, unbind });
      input.signal?.addEventListener("abort", cancel, { once: true });
      if (input.signal?.aborted) {
        cancel();
        return;
      }
      try {
        worker.postMessage(request, [bytes]);
      } catch (error) {
        settle(() => reject(error));
      }
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeWorker();
    return this.closePromise;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const workerUrl = new URL(
      import.meta.url.endsWith(".ts") ? "./AgentImageNormalizationWorker.ts" : "./AgentImageNormalizationWorker.js",
      import.meta.url,
    );
    const worker = new Worker(resolveAgentWorkerThreadEntry(workerUrl), {
      execArgv: resolveAgentWorkerThreadExecArgv(),
      workerData: resolveAgentWorkerThreadData(workerUrl),
    });
    worker.unref();
    worker.on("message", (message: AgentImageNormalizationWorkerResponse) => this.handleResponse(message));
    worker.on("error", (error) => this.handleWorkerFailure(error));
    worker.on("exit", (code) => {
      if (!this.closePromise)
        this.handleWorkerFailure(new Error(`Image normalization worker exited with code ${code}.`));
    });
    this.worker = worker;
    return worker;
  }

  private handleResponse(message: AgentImageNormalizationWorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    pending.unbind();
    if (message.type === "failed") {
      pending.reject(new AgentImageNormalizationError(message.error.code, message.error.message));
      return;
    }
    pending.resolve({
      bytes: Buffer.from(message.image.bytes),
      mime: message.image.mime,
      ...(message.image.width === undefined ? {} : { width: message.image.width }),
      ...(message.image.height === undefined ? {} : { height: message.image.height }),
      animated: message.image.animated,
      sourceSha256: message.image.sourceSha256,
      policyKey: message.image.policyKey,
      derived: message.image.derived,
    });
  }

  private handleWorkerFailure(error: unknown): void {
    if (this.closePromise || this.terminalError) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    this.terminalError = failure;
    const worker = this.worker;
    worker?.removeAllListeners();
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      pending.unbind();
      pending.reject(failure);
    }
    this.pending.clear();
    if (worker) void worker.terminate();
  }

  private async closeWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    const closed = new Error("Image normalization service is closed.");
    for (const pending of this.pending.values()) {
      pending.unbind();
      pending.reject(closed);
    }
    this.pending.clear();
    if (!worker) return;
    worker.removeAllListeners();
    await worker.terminate();
  }
}

export function normalizeImageInputCapabilities(input: AgentImageInputCapabilities): AgentImageInputCapabilities {
  const supportedMimeTypes = [...new Set(input.supportedMimeTypes.map(normalizeAgentImageMime))]
    .filter((mime): mime is string => Boolean(mime))
    .sort();
  if (supportedMimeTypes.length === 0 || supportedMimeTypes.some((mime) => !mime.startsWith("image/"))) {
    throw new TypeError("Image input capabilities must declare one or more image MIME types.");
  }
  const supportedAnimatedMimeTypes = [...new Set((input.supportedAnimatedMimeTypes ?? []).map(normalizeAgentImageMime))]
    .filter((mime): mime is string => Boolean(mime))
    .sort();
  if (supportedAnimatedMimeTypes.some((mime) => !supportedMimeTypes.includes(mime))) {
    throw new TypeError("Animated image MIME types must also appear in supported MIME types.");
  }
  return {
    supportedMimeTypes,
    ...(supportedAnimatedMimeTypes.length > 0 ? { supportedAnimatedMimeTypes } : {}),
    ...(input.maxBytes === undefined ? {} : { maxBytes: normalizePositiveInteger(input.maxBytes, "maxBytes") }),
    ...(input.maxPixels === undefined ? {} : { maxPixels: normalizePositiveInteger(input.maxPixels, "maxPixels") }),
  };
}

export function createAgentImageNormalizationPolicyKey(target: AgentImageInputCapabilities): string {
  const normalized = normalizeImageInputCapabilities(target);
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        revision: AgentImageNormalizationPolicyRevision,
        supportedMimeTypes: normalized.supportedMimeTypes,
        supportedAnimatedMimeTypes: normalized.supportedAnimatedMimeTypes ?? [],
        maxBytes: normalized.maxBytes ?? null,
        maxPixels: normalized.maxPixels ?? null,
      }),
    )
    .digest("hex");
}

export function isAgentNormalizableRasterImageMime(value: string | undefined): boolean {
  return typeof value === "string" && AgentNormalizableRasterImageMimeTypeSet.has(value.trim().toLowerCase());
}

/** Canonicalizes compatibility aliases before checking an image contract. */
export function normalizeAgentImageMime(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

/**
 * One final contract predicate shared by normalizers and their callers.
 * MIME support alone is insufficient because animation is an independent
 * model capability: an endpoint may accept static WebP but not animated WebP.
 */
export function matchesAgentImageInputCapabilities(
  image: AgentImageInputDescriptor,
  target: AgentImageInputCapabilities,
): boolean {
  return resolveAgentImageInputCapabilityViolation(image, target) === undefined;
}

/**
 * Resolves the first unmet model-media condition in a stable order. Callers
 * can retain precise user-facing diagnostics without reimplementing media
 * contract semantics beside the normalizer.
 */
export function resolveAgentImageInputCapabilityViolation(
  image: AgentImageInputDescriptor,
  target: AgentImageInputCapabilities,
): AgentImageInputCapabilityViolation | undefined {
  const normalizedTarget = normalizeImageInputCapabilities(target);
  const mime = normalizeAgentImageMime(image.mime);
  if (!mime || !normalizedTarget.supportedMimeTypes.includes(mime)) {
    return AgentImageInputCapabilityViolations.UnsupportedMime;
  }
  if (image.animated && !normalizedTarget.supportedAnimatedMimeTypes?.includes(mime)) {
    return AgentImageInputCapabilityViolations.AnimatedNotSupported;
  }
  if (normalizedTarget.maxBytes !== undefined && image.byteLength > normalizedTarget.maxBytes) {
    return AgentImageInputCapabilityViolations.ByteLimitExceeded;
  }
  if (
    normalizedTarget.maxPixels !== undefined &&
    (image.width === undefined || image.height === undefined || image.width * image.height > normalizedTarget.maxPixels)
  ) {
    return AgentImageInputCapabilityViolations.PixelLimitExceeded;
  }
  return undefined;
}

function normalizePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${field} must be a positive safe integer.`);
  return value;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function toTransferableBytes(bytes: Uint8Array, transferOwnership = false): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    if (transferOwnership && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
      return bytes.buffer;
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  // Shared buffers are readable but cannot be transferred to a Worker.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
