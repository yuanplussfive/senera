import type { UploadAttachmentData } from "./eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { resolveBackendMessage, type BackendMessageData } from "../i18n/backendMessage";
import { SeneraResourceHttpRoutes } from "./resourceContract";
import { parseResourceId } from "./resourceUri";

export interface UploadResponse {
  ok: true;
  resources: UploadAttachmentData[];
}

export interface UploadErrorResponse {
  ok: false;
  error?: BackendMessageData & {
    code?: string;
  };
}

export interface UploadProgress {
  loaded: number;
  total?: number;
  ratio?: number;
}

export interface UploadFileOptions {
  onProgress?: (progress: UploadProgress) => void;
  headers?: Readonly<Record<string, string>>;
}

export const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

export function buildResourceUploadUrl(httpBaseUrl: string): string {
  const url = new URL(SeneraResourceHttpRoutes.Collection, `${httpBaseUrl.replace(/\/+$/u, "")}/`);
  url.pathname = SeneraResourceHttpRoutes.Collection;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildResourceContentUrl(resourceBaseUrl: string, resourceUri: string): string | undefined {
  const resourceId = parseResourceId(resourceUri);
  if (!resourceId) return undefined;

  let url: URL;
  try {
    url = new URL(resourceBaseUrl, window.location.href);
  } catch {
    return undefined;
  }
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  }
  url.pathname = `${SeneraResourceHttpRoutes.Collection}/${encodeURIComponent(resourceId)}`;
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

export function uploadFile(
  uploadUrl: string,
  file: File,
  options: UploadFileOptions = {},
): Promise<UploadAttachmentData> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);

    request.upload.addEventListener("progress", (event) => {
      options.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : undefined,
        ratio: event.lengthComputable && event.total > 0 ? event.loaded / event.total : undefined,
      });
    });

    request.addEventListener("load", () => {
      const payload = parseUploadResponse(request.responseText);
      if (!isUploadSuccess(request.status, payload)) {
        reject(new Error(readUploadErrorMessage(payload)));
        return;
      }

      const [resource] = payload.resources;
      if (!isUploadAttachment(resource)) {
        reject(new Error(frontendMessage("upload.emptyResponse")));
        return;
      }

      options.onProgress?.({
        loaded: resource.size,
        total: resource.size,
        ratio: 1,
      });
      resolve(resource);
    });

    request.addEventListener("error", () => {
      reject(new Error(frontendMessage("upload.networkFailed")));
    });
    request.addEventListener("abort", () => {
      reject(new Error(frontendMessage("upload.aborted")));
    });
    request.addEventListener("timeout", () => {
      reject(new Error(frontendMessage("upload.timeout")));
    });

    request.open("POST", uploadUrl);
    request.timeout = DEFAULT_UPLOAD_TIMEOUT_MS;
    request.withCredentials = true;
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      request.setRequestHeader(name, value);
    }
    request.send(form);
  });
}

function parseUploadResponse(value: string): unknown {
  try {
    return JSON.parse(value) as UploadResponse | UploadErrorResponse;
  } catch {
    return {
      ok: false,
      error: {
        message: frontendMessage("upload.invalidJsonResponse"),
      },
    };
  }
}

function isUploadSuccess(status: number, payload: unknown): payload is UploadResponse {
  return status >= 200 && status < 300 && isRecord(payload) && payload.ok === true && Array.isArray(payload.resources);
}

function readUploadErrorMessage(payload: unknown): string {
  if (!isRecord(payload) || payload.ok !== false || !isRecord(payload.error)) {
    return frontendMessage("upload.failed");
  }
  return resolveBackendMessage(payload.error) ?? frontendMessage("upload.failed");
}

function isUploadAttachment(value: unknown): value is UploadAttachmentData {
  return (
    isRecord(value) &&
    typeof value.resourceUri === "string" &&
    parseResourceId(value.resourceUri) !== undefined &&
    typeof value.name === "string" &&
    typeof value.mime === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    value.status === "uploaded" &&
    (value.sha256 === undefined || typeof value.sha256 === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
