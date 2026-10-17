import { resolveBackendMessage } from "../i18n/backendMessage";

import { SeneraResourceHttpRoutes } from "./resourceContract";
import { buildHttpApiUrl } from "./httpApiUrl";

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

export interface WorkspaceTreeEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "directory" | "file" | WorkspaceResourceKind;
  readonly mime?: string;
  readonly size?: number;
  readonly editable?: boolean;
  readonly etag?: string;
}

interface WorkspaceResourceResponse {
  readonly ok: true;
  readonly resource: WorkspaceResourceData;
}

interface WorkspaceTreeResponse {
  readonly ok: true;
  readonly path: string;
  readonly entries: readonly WorkspaceTreeEntry[];
}

interface WorkspaceTreeEntryResponse {
  readonly ok: true;
  readonly entry: WorkspaceTreeEntry;
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
  const url = new URL(
    buildHttpApiUrl(httpBaseUrl, raw ? SeneraResourceHttpRoutes.WorkspaceContent : SeneraResourceHttpRoutes.Collection),
  );
  url.searchParams.set("path", path);
  return url.toString();
}

export function buildWorkspaceTreeUrl(httpBaseUrl: string, path = "."): string {
  const url = new URL(buildHttpApiUrl(httpBaseUrl, SeneraResourceHttpRoutes.WorkspaceTree));
  if (path && path !== ".") url.searchParams.set("path", path);
  return url.toString();
}

export async function readWorkspaceResource(
  httpBaseUrl: string,
  path: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WorkspaceResourceData> {
  const response = await fetch(buildWorkspaceResourceUrl(httpBaseUrl, path), {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal: options.signal,
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

export async function listWorkspaceEntries(
  httpBaseUrl: string,
  path = ".",
  options: { signal?: AbortSignal; query?: string } = {},
): Promise<readonly WorkspaceTreeEntry[]> {
  const url = new URL(buildWorkspaceTreeUrl(httpBaseUrl, path));
  if (options.query) url.searchParams.set("query", options.query);
  const response = await fetch(url, {
    signal: options.signal,
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await readJson(response);
  if (!response.ok || !isWorkspaceTreeResponse(payload)) throw readPayloadError(response, payload);
  return payload.entries;
}

export async function createWorkspaceEntry(
  httpBaseUrl: string,
  path: string,
  operation: "file" | "directory",
  content = "",
  csrfToken?: string,
): Promise<WorkspaceTreeEntry> {
  const response = await fetch(buildWorkspaceTreeUrl(httpBaseUrl), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
    },
    body: JSON.stringify({ operation, path, ...(operation === "file" ? { content } : {}) }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isWorkspaceTreeEntryResponse(payload)) throw readPayloadError(response, payload);
  return payload.entry;
}

export async function renameWorkspaceEntry(
  httpBaseUrl: string,
  source: string,
  destination: string,
  csrfToken?: string,
): Promise<WorkspaceTreeEntry> {
  const response = await fetch(buildWorkspaceTreeUrl(httpBaseUrl), {
    method: "PATCH",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
    },
    body: JSON.stringify({ source, destination }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isWorkspaceTreeEntryResponse(payload)) throw readPayloadError(response, payload);
  return payload.entry;
}

export async function removeWorkspaceEntry(
  httpBaseUrl: string,
  path: string,
  recursive: boolean,
  csrfToken?: string,
): Promise<void> {
  const url = new URL(buildWorkspaceTreeUrl(httpBaseUrl, path));
  url.searchParams.set("path", path);
  if (recursive) url.searchParams.set("recursive", "true");
  const response = await fetch(url, {
    method: "DELETE",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
    },
  });
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload) || payload.ok !== true) throw readPayloadError(response, payload);
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

function isWorkspaceTreeResponse(value: unknown): value is WorkspaceTreeResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.path === "string" &&
    Array.isArray(value.entries) &&
    value.entries.every(isWorkspaceTreeEntry)
  );
}

function isWorkspaceTreeEntryResponse(value: unknown): value is WorkspaceTreeEntryResponse {
  return isRecord(value) && value.ok === true && isWorkspaceTreeEntry(value.entry);
}

function isWorkspaceTreeEntry(value: unknown): value is WorkspaceTreeEntry {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.name !== "string") return false;
  if (value.kind === "directory" || value.kind === "file") return true;
  return value.kind === "text" || value.kind === "image" || value.kind === "binary";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
