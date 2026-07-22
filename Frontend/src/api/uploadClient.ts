import type { UploadAttachmentData } from "./eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface UploadResponse {
  ok: true;
  uploads: UploadAttachmentData[];
}

export interface UploadErrorResponse {
  ok: false;
  error?: {
    code?: string;
    message?: string;
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

const UploadReference = {
  protocol: "senera:",
  host: "upload",
} as const;

const UploadHttpPath = "/api/uploads";

export function buildUploadUrl(webSocketUrl: string): string {
  const url = new URL(webSocketUrl, window.location.href);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = UploadHttpPath;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildUploadContentUrl(uploadBaseUrl: string, uploadUri: string): string | undefined {
  const uploadId = parseUploadId(uploadUri);
  if (!uploadId) return undefined;

  let url: URL;
  try {
    url = new URL(uploadBaseUrl, window.location.href);
  } catch {
    return undefined;
  }
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  }
  url.pathname = `${UploadHttpPath}/${encodeURIComponent(uploadId)}/content`;
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

      const [upload] = payload.uploads;
      if (!isUploadAttachment(upload)) {
        reject(new Error(frontendMessage("upload.emptyResponse")));
        return;
      }

      options.onProgress?.({
        loaded: upload.size,
        total: upload.size,
        ratio: 1,
      });
      resolve(upload);
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
  return status >= 200 && status < 300 && isRecord(payload) && payload.ok === true && Array.isArray(payload.uploads);
}

function readUploadErrorMessage(payload: unknown): string {
  if (!isRecord(payload) || payload.ok !== false || !isRecord(payload.error)) {
    return frontendMessage("upload.failed");
  }
  return typeof payload.error.message === "string" ? payload.error.message : frontendMessage("upload.failed");
}

function isUploadAttachment(value: unknown): value is UploadAttachmentData {
  return (
    isRecord(value) &&
    typeof value.uploadUri === "string" &&
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

function parseUploadId(value: string): string | undefined {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return undefined;
  }

  if (
    uri.protocol !== UploadReference.protocol ||
    uri.hostname !== UploadReference.host ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.search ||
    uri.hash
  ) {
    return undefined;
  }

  const segments = uri.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return undefined;

  try {
    const uploadId = decodeURIComponent(segments[0]);
    return uploadId && uploadId !== "." && uploadId !== ".." && !/[\\/]/u.test(uploadId) ? uploadId : undefined;
  } catch {
    return undefined;
  }
}
