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

export function buildUploadUrl(webSocketUrl: string): string {
  const url = new URL(webSocketUrl, window.location.href);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api/uploads";
  url.search = "";
  url.hash = "";
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
      if (!upload) {
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
    request.withCredentials = true;
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      request.setRequestHeader(name, value);
    }
    request.send(form);
  });
}

function parseUploadResponse(value: string): UploadResponse | UploadErrorResponse {
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

function isUploadSuccess(status: number, payload: UploadResponse | UploadErrorResponse): payload is UploadResponse {
  return status >= 200 && status < 300 && payload.ok;
}

function readUploadErrorMessage(payload: UploadResponse | UploadErrorResponse): string {
  return payload.ok ? frontendMessage("upload.failed") : (payload.error?.message ?? frontendMessage("upload.failed"));
}
