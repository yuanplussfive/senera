import { resolveBackendMessage } from "../i18n/backendMessage";

const WorkspaceResourcePath = "/api/workspace-resources";

export type WorkspaceResourceKind = "text" | "image" | "binary";

export interface WorkspaceResourceData {
  readonly path: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly kind: WorkspaceResourceKind;
  readonly editable: boolean;
  readonly etag: string;
  readonly content?: string;
}

interface WorkspaceResourceResponse {
  readonly ok: true;
  readonly resource: WorkspaceResourceData;
}

export class WorkspaceResourceClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function buildWorkspaceResourceUrl(httpBaseUrl: string, path: string, raw = false): string {
  const url = new URL(httpBaseUrl, window.location.href);
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  }
  url.pathname = raw ? `${WorkspaceResourcePath}/content` : WorkspaceResourcePath;
  url.search = "";
  url.searchParams.set("path", path);
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

export async function readWorkspaceResource(httpBaseUrl: string, path: string): Promise<WorkspaceResourceData> {
  const response = await fetch(buildWorkspaceResourceUrl(httpBaseUrl, path), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return readResourceResponse(response);
}

export async function readWorkspaceResourceBlob(httpBaseUrl: string, path: string): Promise<Blob> {
  const response = await fetch(buildWorkspaceResourceUrl(httpBaseUrl, path, true), {
    credentials: "include",
  });
  if (!response.ok) throw await readClientError(response);
  return response.blob();
}

export async function saveWorkspaceResource(
  httpBaseUrl: string,
  path: string,
  content: string,
  etag: string,
  csrfToken?: string,
): Promise<WorkspaceResourceData> {
  const response = await fetch(buildWorkspaceResourceUrl(httpBaseUrl, path), {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "If-Match": etag,
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
    },
    body: content,
  });
  return readResourceResponse(response);
}

async function readResourceResponse(response: Response): Promise<WorkspaceResourceData> {
  const payload = await readJson(response);
  if (!response.ok || !isResourceResponse(payload)) throw readPayloadError(response, payload);
  return payload.resource;
}

async function readClientError(response: Response): Promise<WorkspaceResourceClientError> {
  const payload = await readJson(response);
  return readPayloadError(response, payload);
}

function readPayloadError(response: Response, payload: unknown): WorkspaceResourceClientError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  return new WorkspaceResourceClientError(
    resolveBackendMessage(error) ?? response.statusText ?? "Workspace resource request failed.",
    response.status,
    typeof error?.code === "string" ? error.code : undefined,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isResourceResponse(value: unknown): value is WorkspaceResourceResponse {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.resource)) return false;
  const resource = value.resource;
  return (
    typeof resource.path === "string" &&
    typeof resource.name === "string" &&
    typeof resource.mime === "string" &&
    typeof resource.size === "number" &&
    ["text", "image", "binary"].includes(String(resource.kind)) &&
    typeof resource.editable === "boolean" &&
    typeof resource.etag === "string" &&
    (resource.content === undefined || typeof resource.content === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
