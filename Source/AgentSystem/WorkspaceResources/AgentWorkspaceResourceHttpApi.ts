import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream";
import { isText } from "istextorbinary";
import { lookup } from "mime-types";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  isMissingFileError,
  removeAgentPathWithRetry,
  withAgentFileAccessRetry,
  writeFileAtomic,
} from "../Core/AgentFs.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import {
  SeneraWorkspaceBoundary,
  SeneraWorkspaceBoundaryError,
  type SeneraOpenedWorkspaceFile,
} from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import { AgentResourceHttpRoutes } from "../Resources/AgentResourceContract.js";
import { AgentWorkspaceFileChanges } from "./AgentWorkspaceFileChanges.js";
import { AgentWorkspacePathIndex } from "./AgentWorkspacePathIndex.js";

export interface AgentWorkspaceResourceHttpApiOptions {
  readonly workspaceRoot: string;
  readonly maxTextBytes: number;
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

type WorkspaceResourceRoute = "resource" | "content" | "tree" | "changes";
type WorkspaceResourceKind = "text" | "image" | "binary";

interface WorkspaceTreeResponse {
  readonly ok: true;
  readonly path: string;
  readonly entries: readonly WorkspaceTreeEntry[];
}

interface WorkspaceTreeEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "directory" | "file" | WorkspaceResourceKind;
  readonly mime?: string;
  readonly size?: number;
  readonly editable?: boolean;
  readonly etag?: string;
}

interface WorkspaceCreateRequest {
  readonly operation: "file" | "directory";
  readonly path: string;
  readonly content?: string;
}

interface WorkspaceRenameRequest {
  readonly source: string;
  readonly destination: string;
}

interface WorkspaceResourceSnapshot {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly kind: WorkspaceResourceKind;
  readonly editable: boolean;
  readonly content?: string;
  readonly etag: string;
}

class AgentWorkspaceResourceHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const BinaryMimeType = "application/octet-stream";
const SampleBytes = 8 * 1024;
const SvgMimeType = "image/svg+xml";
const BrowserImageMimeTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
  SvgMimeType,
]);

export class AgentWorkspaceResourceHttpApi {
  private readonly boundary: SeneraWorkspaceBoundary;
  private readonly leases = new AgentKeyedLeaseQueue<string>();
  private readonly changes: AgentWorkspaceFileChanges;
  private readonly pathIndex: AgentWorkspacePathIndex;

  constructor(private readonly options: AgentWorkspaceResourceHttpApiOptions) {
    this.pathIndex = new AgentWorkspacePathIndex(options.workspaceRoot);
    this.changes = new AgentWorkspaceFileChanges(options.workspaceRoot, (paths) => this.pathIndex.invalidate(paths));
    this.boundary = new SeneraWorkspaceBoundary({
      workspaceRoot: options.workspaceRoot,
      linkPolicy: "deny",
    });
  }

  canHandle(request: IncomingMessage): boolean {
    return this.readRoute(request) !== undefined;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = this.readRoute(request);
    if (!route) {
      this.sendError(response, 404, "not_found", "Workspace resource route was not found.");
      return;
    }

    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "HEAD", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "If-Match", "X-Senera-Csrf"],
        isOriginAllowed: (origin, corsRequest) => this.options.isOriginAllowed?.(origin, corsRequest) ?? false,
      })
    ) {
      this.sendError(response, 403, "forbidden_origin", "The request origin is not allowed.");
      return;
    }

    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }

    try {
      if (route === "changes") {
        if (request.method !== "GET") throw new AgentWorkspaceResourceHttpError(405, "method_not_allowed", "Use GET.");
        await this.changes.subscribe(response);
      } else if (route === "tree") {
        await this.handleTree(request, response);
      } else {
        const resourcePath = this.readResourcePath(request);
        if (route === "content") {
          await this.handleContent(request, response, resourcePath);
        } else {
          await this.handleResource(request, response, resourcePath);
        }
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const failure = projectWorkspaceResourceError(error);
      this.sendError(response, failure.statusCode, failure.code, failure.message);
    }
  }

  private async handleResource(
    request: IncomingMessage,
    response: ServerResponse,
    resourcePath: string,
  ): Promise<void> {
    if (request.method === "GET" || request.method === "HEAD") {
      const snapshot = await this.readSnapshot(resourcePath);
      this.sendJson(
        response,
        200,
        {
          ok: true,
          resource: projectSnapshot(snapshot),
        },
        request.method === "HEAD",
        { ETag: snapshot.etag },
      );
      return;
    }

    if (request.method !== "PUT") {
      throw new AgentWorkspaceResourceHttpError(405, "method_not_allowed", "Use GET, HEAD, or PUT.");
    }

    const expectedEtag = readSingleHeader(request.headers["if-match"]);
    if (!expectedEtag) {
      throw new AgentWorkspaceResourceHttpError(428, "revision_required", "Saving requires an If-Match revision.");
    }
    const content = await readTextBody(request, this.options.maxTextBytes);
    const snapshot = await this.saveText(resourcePath, content, expectedEtag);
    this.sendJson(
      response,
      200,
      {
        ok: true,
        resource: projectSnapshot(snapshot),
      },
      false,
      { ETag: snapshot.etag },
    );
  }

  private async handleTree(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "GET") {
      const resourcePath = this.readResourcePath(request, true);
      const query = new URL(request.url ?? "/", "http://senera.local").searchParams.get("query");
      const entries = query ? await this.searchPaths(query) : await this.readDirectory(resourcePath);
      const body: WorkspaceTreeResponse = { ok: true, path: resourcePath === "." ? "" : resourcePath, entries };
      this.sendJson(response, 200, body);
      return;
    }

    if (request.method === "POST") {
      const created = await this.createEntry(await readJsonBody(request, this.options.maxTextBytes));
      this.sendJson(response, 201, { ok: true, entry: created });
      return;
    }

    if (request.method === "PATCH") {
      const renamed = await this.renameEntry(await readJsonBody(request, this.options.maxTextBytes));
      this.sendJson(response, 200, { ok: true, entry: renamed });
      return;
    }

    if (request.method === "DELETE") {
      const resourcePath = this.readResourcePath(request);
      await this.removeEntry(
        resourcePath,
        new URL(request.url ?? "/", "http://senera.local").searchParams.get("recursive"),
      );
      this.sendJson(response, 200, { ok: true, path: resourcePath });
      return;
    }

    throw new AgentWorkspaceResourceHttpError(405, "method_not_allowed", "Use GET, POST, PATCH, or DELETE.");
  }

  private async handleContent(request: IncomingMessage, response: ServerResponse, resourcePath: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new AgentWorkspaceResourceHttpError(405, "method_not_allowed", "Raw resources are read-only.");
    }

    const opened = await withAgentFileAccessRetry(() => this.openRegularFile(resourcePath));
    try {
      const stat = await opened.handle.stat();
      const sample = await withAgentFileAccessRetry(() => readSample(opened, stat.size));
      const mime = await detectMime(opened.target.addressedPath, sample);
      const inline = isBrowserImageMime(mime);
      const etag = formatStatEtag(stat.size, stat.mtimeMs);
      response.writeHead(200, {
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Length": stat.size,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": mime || BinaryMimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
          path.basename(opened.target.addressedPath),
        )}`,
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      await new Promise<void>((resolve, reject) => {
        pipeline(opened.handle.createReadStream({ autoClose: false, start: 0 }), response, (error) =>
          error ? reject(error) : resolve(),
        );
      });
    } finally {
      await opened.handle.close().catch(() => undefined);
    }
  }

  private async readSnapshot(resourcePath: string): Promise<WorkspaceResourceSnapshot> {
    return this.readFileInspection(resourcePath, true);
  }

  private async readFileInspection(resourcePath: string, includeContent: boolean): Promise<WorkspaceResourceSnapshot> {
    const opened = await withAgentFileAccessRetry(() => this.openRegularFile(resourcePath));
    try {
      const stat = await opened.handle.stat();
      const sample = await withAgentFileAccessRetry(() => readSample(opened, stat.size));
      const mime = await detectMime(opened.target.addressedPath, sample);
      const kind = classifyResource(opened.target.addressedPath, mime, sample);
      const editable = kind === "text" && stat.size <= this.options.maxTextBytes;
      const contentBuffer =
        includeContent && editable ? await withAgentFileAccessRetry(() => opened.handle.readFile()) : undefined;
      const etag = contentBuffer ? formatContentEtag(contentBuffer) : formatStatEtag(stat.size, stat.mtimeMs);
      return {
        absolutePath: opened.target.absolutePath,
        relativePath: opened.target.facts.relativePath,
        name: path.basename(opened.target.addressedPath),
        mime,
        size: stat.size,
        kind,
        editable,
        content: contentBuffer?.toString("utf8"),
        etag,
      };
    } finally {
      await opened.handle.close().catch(() => undefined);
    }
  }

  private async saveText(
    resourcePath: string,
    content: string,
    expectedEtag: string,
  ): Promise<WorkspaceResourceSnapshot> {
    const target = await this.boundary.resolve(resourcePath, AgentResourceAccessIntents.Replace);
    return this.leases.run(target.absolutePath, async () => {
      const current = await this.readSnapshot(resourcePath);
      if (!current.editable || current.content === undefined) {
        throw new AgentWorkspaceResourceHttpError(415, "resource_not_editable", "The resource is not editable text.");
      }
      if (!matchesEtag(expectedEtag, current.etag)) {
        throw new AgentWorkspaceResourceHttpError(
          412,
          "resource_changed",
          "The file changed after it was opened. Reload it before saving.",
        );
      }

      const stat = await fs.promises.stat(target.absolutePath);
      await writeFileAtomic(target.absolutePath, content, { mode: stat.mode });
      return this.readSnapshot(resourcePath);
    });
  }

  private async openRegularFile(resourcePath: string): Promise<SeneraOpenedWorkspaceFile> {
    const opened = await this.boundary.openFile(resourcePath, AgentResourceAccessIntents.Read);
    const stat = await opened.handle.stat();
    if (!stat.isFile()) {
      await opened.handle.close().catch(() => undefined);
      throw new AgentWorkspaceResourceHttpError(415, "resource_not_file", "The workspace resource is not a file.");
    }
    return opened;
  }

  private async readDirectory(resourcePath: string): Promise<readonly WorkspaceTreeEntry[]> {
    const target = await this.boundary.resolve(resourcePath, AgentResourceAccessIntents.Read);
    const stat = await fs.promises.stat(target.absolutePath);
    if (!stat.isDirectory()) {
      throw new AgentWorkspaceResourceHttpError(
        415,
        "resource_not_directory",
        "The workspace resource is not a directory.",
      );
    }

    const entries = await fs.promises.readdir(target.absolutePath, { withFileTypes: true });
    return (
      await Promise.all(
        entries
          .filter((entry) => !entry.isSymbolicLink())
          .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }))
          .map((entry) =>
            this.readTreeEntry(path.posix.join(resourcePath === "." ? "" : resourcePath, entry.name), entry),
          ),
      )
    ).filter((entry): entry is WorkspaceTreeEntry => entry !== undefined);
  }

  private async readTreeEntry(
    resourcePath: string,
    entry: Pick<import("node:fs").Dirent, "isDirectory" | "isFile">,
  ): Promise<WorkspaceTreeEntry | undefined> {
    const normalizedPath = resourcePath;
    if (entry.isDirectory()) {
      return { path: normalizedPath, name: path.posix.basename(normalizedPath), kind: "directory" };
    }
    if (!entry.isFile()) return undefined;
    const snapshot = await this.readFileInspection(normalizedPath, false);
    return {
      path: snapshot.relativePath,
      name: snapshot.name,
      kind: snapshot.kind,
      mime: snapshot.mime,
      size: snapshot.size,
      editable: snapshot.editable,
      etag: snapshot.etag,
    };
  }

  private async createEntry(payload: unknown): Promise<WorkspaceTreeEntry> {
    const input = readCreateRequest(payload);
    const target = await this.boundary.resolve(input.path, AgentResourceAccessIntents.Create);
    await assertMissingTarget(target.absolutePath);
    await fs.promises.mkdir(path.dirname(target.absolutePath), { recursive: true });
    if (input.operation === "directory") {
      await fs.promises.mkdir(target.absolutePath);
      return { path: normalizeWorkspacePath(input.path), name: path.basename(target.absolutePath), kind: "directory" };
    }
    await fs.promises.writeFile(target.absolutePath, input.content ?? "", { encoding: "utf8", flag: "wx" });
    const snapshot = await this.readSnapshot(normalizeWorkspacePath(input.path));
    return {
      path: snapshot.relativePath,
      name: snapshot.name,
      kind: snapshot.kind,
      mime: snapshot.mime,
      size: snapshot.size,
      editable: snapshot.editable,
      etag: snapshot.etag,
    };
  }

  private async renameEntry(payload: unknown): Promise<WorkspaceTreeEntry> {
    const input = readRenameRequest(payload);
    const source = await this.boundary.resolve(input.source, AgentResourceAccessIntents.Remove);
    const destination = await this.boundary.resolve(input.destination, AgentResourceAccessIntents.Replace);
    const sourceStat = await fs.promises.lstat(source.absolutePath);
    await assertMissingTarget(destination.absolutePath);
    await fs.promises.mkdir(path.dirname(destination.absolutePath), { recursive: true });
    await fs.promises.rename(source.absolutePath, destination.absolutePath);
    if (sourceStat.isDirectory()) {
      return {
        path: normalizeWorkspacePath(input.destination),
        name: path.basename(destination.absolutePath),
        kind: "directory",
      };
    }
    return this.readSnapshot(normalizeWorkspacePath(input.destination)).then((snapshot) => ({
      path: snapshot.relativePath,
      name: snapshot.name,
      kind: snapshot.kind,
      mime: snapshot.mime,
      size: snapshot.size,
      editable: snapshot.editable,
      etag: snapshot.etag,
    }));
  }

  private async removeEntry(resourcePath: string, recursiveValue: string | null): Promise<void> {
    const target = await this.boundary.resolve(resourcePath, AgentResourceAccessIntents.Remove);
    if (path.resolve(target.absolutePath) === this.boundary.workspaceRoot) {
      throw new AgentWorkspaceResourceHttpError(
        400,
        "workspace_root_forbidden",
        "The workspace root cannot be removed.",
      );
    }
    const stat = await fs.promises.lstat(target.absolutePath);
    const recursive = recursiveValue === "true";
    if (stat.isDirectory() && !recursive) {
      throw new AgentWorkspaceResourceHttpError(
        409,
        "directory_not_empty",
        "Delete a directory recursively to remove it.",
      );
    }
    await removeAgentPathWithRetry(target.absolutePath, { recursive });
  }

  private readResourcePath(request: IncomingMessage, allowDefault = false): string {
    const url = new URL(request.url ?? "/", "http://senera.local");
    const value = url.searchParams.get("path")?.trim();
    if (!value && !allowDefault) {
      throw new AgentWorkspaceResourceHttpError(400, "path_required", "A workspace resource path is required.");
    }
    return normalizeWorkspacePath(value || ".");
  }

  private readRoute(request: IncomingMessage): WorkspaceResourceRoute | undefined {
    try {
      const url = new URL(request.url ?? "/", "http://senera.local");
      if (url.pathname === AgentResourceHttpRoutes.WorkspaceChanges) return "changes";
      if (url.pathname === AgentResourceHttpRoutes.WorkspaceTree) return "tree";
      if (url.pathname === AgentResourceHttpRoutes.Collection && url.searchParams.has("path")) return "resource";
      if (url.pathname === AgentResourceHttpRoutes.WorkspaceContent && url.searchParams.has("path")) return "content";
      return undefined;
    } catch {
      return undefined;
    }
  }

  private sendJson(
    response: ServerResponse,
    statusCode: number,
    value: unknown,
    head = false,
    headers: Readonly<Record<string, string>> = {},
  ): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    });
    response.end(head ? undefined : body);
  }

  private sendError(response: ServerResponse, statusCode: number, code: string, message: string): void {
    this.sendJson(response, statusCode, {
      ok: false,
      error: { code, message },
    });
  }

  close(): Promise<void> {
    return this.changes.close();
  }

  private async searchPaths(query: string): Promise<readonly WorkspaceTreeEntry[]> {
    const files = await this.pathIndex.search(query);
    // Searching names does not read every matching file. Content inspection belongs to opening a resource.
    return files.map((file) => ({ path: file, name: path.posix.basename(file), kind: "file" }));
  }
}

async function readSample(opened: SeneraOpenedWorkspaceFile, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.min(size, SampleBytes));
  if (buffer.length === 0) return buffer;
  const result = await opened.handle.read(buffer, 0, buffer.length, 0);
  return result.bytesRead === buffer.length ? buffer : buffer.subarray(0, result.bytesRead);
}

async function detectMime(addressedPath: string, sample: Buffer): Promise<string> {
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = sample.length > 0 ? await fileTypeFromBuffer(sample) : undefined;
  return normalizeMime(detected?.mime) ?? normalizeMime(lookup(addressedPath) || undefined) ?? BinaryMimeType;
}

function classifyResource(name: string, mime: string, sample: Buffer): WorkspaceResourceKind {
  if (isBrowserImageMime(mime)) return "image";
  return isText(name, sample) === true ? "text" : "binary";
}

function isBrowserImageMime(mime: string): boolean {
  return BrowserImageMimeTypes.has(mime);
}

function normalizeMime(value: string | false | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || undefined;
}

function formatContentEtag(content: Buffer): string {
  return `"sha256-${createHash("sha256").update(content).digest("base64url")}"`;
}

function formatStatEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

function matchesEtag(candidate: string, expected: string): boolean {
  return candidate
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === expected);
}

function readSingleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

async function readTextBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new AgentWorkspaceResourceHttpError(413, "resource_too_large", "The edited content is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const text = await readTextBody(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentWorkspaceResourceHttpError(400, "invalid_json", "The workspace mutation body is not valid JSON.");
  }
}

function readCreateRequest(value: unknown): WorkspaceCreateRequest {
  if (!isRecord(value) || (value.operation !== "file" && value.operation !== "directory")) {
    throw new AgentWorkspaceResourceHttpError(
      400,
      "invalid_create_request",
      "A file or directory operation is required.",
    );
  }
  const resourcePath = readMutationPath(value.path, "path");
  if (resourcePath === ".") {
    throw new AgentWorkspaceResourceHttpError(400, "workspace_root_forbidden", "The workspace root cannot be created.");
  }
  if (value.operation === "file" && value.content !== undefined && typeof value.content !== "string") {
    throw new AgentWorkspaceResourceHttpError(400, "invalid_create_content", "New file content must be text.");
  }
  return {
    operation: value.operation,
    path: resourcePath,
    ...(typeof value.content === "string" ? { content: value.content } : {}),
  };
}

function readRenameRequest(value: unknown): WorkspaceRenameRequest {
  if (!isRecord(value)) {
    throw new AgentWorkspaceResourceHttpError(
      400,
      "invalid_rename_request",
      "A source and destination path are required.",
    );
  }
  const source = readMutationPath(value.source, "source");
  const destination = readMutationPath(value.destination, "destination");
  if (source === "." || destination === ".") {
    throw new AgentWorkspaceResourceHttpError(400, "workspace_root_forbidden", "The workspace root cannot be renamed.");
  }
  return { source, destination };
}

function readMutationPath(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AgentWorkspaceResourceHttpError(400, `invalid_${name}`, `A valid ${name} path is required.`);
  }
  const candidate = value.trim();
  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/u.test(candidate)) {
    throw new AgentWorkspaceResourceHttpError(400, `invalid_${name}`, `The ${name} must be relative to the workspace.`);
  }
  return normalizeWorkspacePath(candidate);
}

async function assertMissingTarget(target: string): Promise<void> {
  try {
    await fs.promises.lstat(target);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  throw new AgentWorkspaceResourceHttpError(409, "resource_exists", "The target workspace resource already exists.");
}

function normalizeWorkspacePath(value: string): string {
  const normalized = value
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/");
  return normalized || ".";
}

function projectSnapshot(snapshot: WorkspaceResourceSnapshot): Record<string, unknown> {
  return {
    path: snapshot.relativePath,
    name: snapshot.name,
    mime: snapshot.mime,
    size: snapshot.size,
    kind: snapshot.kind,
    editable: snapshot.editable,
    etag: snapshot.etag,
    ...(snapshot.content === undefined ? {} : { content: snapshot.content }),
  };
}

function projectWorkspaceResourceError(error: unknown): AgentWorkspaceResourceHttpError {
  if (error instanceof AgentWorkspaceResourceHttpError) return error;
  if (error instanceof SeneraWorkspaceBoundaryError) {
    if (error.code === "outside_workspace" || error.code === "link_not_allowed" || error.code === "policy_denied") {
      return new AgentWorkspaceResourceHttpError(403, error.code, error.message);
    }
    return new AgentWorkspaceResourceHttpError(400, error.code, error.message);
  }
  if (isMissingFileError(error)) {
    return new AgentWorkspaceResourceHttpError(404, "resource_not_found", "The workspace resource was not found.");
  }
  return new AgentWorkspaceResourceHttpError(500, "workspace_resource_failed", errorMessage(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
