import { parseResourceId } from "@senera/resource-links";
import type { UploadAttachmentData } from "./uploadTypes";
import { ClientConnectionLifecycle } from "./connectionLifecycle";
export { buildResourceContentUrl, buildResourceUploadUrl } from "@senera/resource-links";

export interface UploadResponse {
  ok: true;
  resources: UploadAttachmentData[];
}

export interface UploadProgress {
  loaded: number;
  total?: number;
  ratio?: number;
}

export interface UploadFileOptions {
  onProgress?: (progress: UploadProgress) => void;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
}

export type ResourceUploadFailure =
  | "aborted"
  | "networkFailed"
  | "timeout"
  | "invalidJsonResponse"
  | "failed"
  | "emptyResponse"
  | "invalidAttachmentResponse";

/** Transport errors carry data; each document translates at its own UI boundary. */
export class ResourceUploadError extends Error {
  constructor(
    readonly code: ResourceUploadFailure,
    readonly backendError?: unknown,
    readonly fields: string[] = [],
  ) {
    super(`Resource upload: ${code}`);
    this.name = "ResourceUploadError";
  }
}

export const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

/** Shared multipart transport for console and channel clients, without a UI runtime dependency. */
export function uploadResource(
  uploadUrl: string,
  file: File,
  options: UploadFileOptions = {},
): Promise<UploadAttachmentData> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ResourceUploadError("aborted"));
      return;
    }
    const request = new XMLHttpRequest();
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout>;
    const abort = () => request.abort();
    const cleanup = () => {
      clearTimeout(idleTimer);
      lifecycle.stop();
      options.signal?.removeEventListener("abort", abort);
    };
    const fail = (code: ResourceUploadFailure, backendError?: unknown, fields?: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ResourceUploadError(code, backendError, fields));
    };
    const form = new FormData();
    form.append("file", file, file.name);
    request.upload.addEventListener("progress", (event) => {
      armIdleTimeout();
      options.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : undefined,
        ratio: event.lengthComputable && event.total > 0 ? event.loaded / event.total : undefined,
      });
    });
    request.addEventListener("progress", () => armIdleTimeout());
    const armIdleTimeout = () => {
      clearTimeout(idleTimer);
      if (settled || lifecycle.paused) return;
      idleTimer = setTimeout(() => {
        // Settle with the useful cause before abort dispatches its own event.
        fail("timeout");
        request.abort();
      }, options.idleTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS);
    };
    const lifecycle = new ClientConnectionLifecycle({
      suspend: () => clearTimeout(idleTimer),
      resume: () => armIdleTimeout(),
    });
    request.addEventListener("load", () => {
      if (settled) return;
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        fail("invalidJsonResponse");
        return;
      }
      if (
        request.status < 200 ||
        request.status >= 300 ||
        !isRecord(payload) ||
        payload.ok !== true ||
        !Array.isArray(payload.resources)
      ) {
        fail("failed", isRecord(payload) ? payload.error : undefined);
        return;
      }
      if (!payload.resources.length) {
        fail("emptyResponse");
        return;
      }
      const resource: unknown = payload.resources[0];
      const fields = readInvalidAttachmentFields(resource);
      if (fields.length) {
        fail("invalidAttachmentResponse", undefined, fields);
        return;
      }
      const attachment = resource as UploadAttachmentData;
      settled = true;
      cleanup();
      options.onProgress?.({ loaded: attachment.size, total: attachment.size, ratio: 1 });
      resolve(attachment);
    });
    request.addEventListener("error", () => fail("networkFailed"));
    request.addEventListener("abort", () => fail("aborted"));
    request.addEventListener("timeout", () => fail("timeout"));
    request.open("POST", uploadUrl);
    request.timeout = 0;
    request.withCredentials = true;
    for (const [name, value] of Object.entries(options.headers ?? {})) request.setRequestHeader(name, value);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      lifecycle.start();
      armIdleTimeout();
      request.send(form);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

function readInvalidAttachmentFields(value: unknown): string[] {
  if (!isRecord(value)) return ["resources[0]"];
  const fields: Readonly<Record<string, boolean>> = {
    resourceUri: typeof value.resourceUri === "string" && parseResourceId(value.resourceUri) !== undefined,
    name: typeof value.name === "string",
    mime: typeof value.mime === "string",
    size: typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0,
    status: value.status === "uploaded",
    sha256: value.sha256 === undefined || typeof value.sha256 === "string",
  };
  return Object.entries(fields).flatMap(([name, valid]) => (valid ? [] : [name]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
