import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream";
import { isText } from "istextorbinary";
import { lookup } from "mime-types";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { isMissingFileError, writeFileAtomic } from "../Core/AgentFs.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import {
  SeneraWorkspaceBoundary,
  SeneraWorkspaceBoundaryError,
  type SeneraOpenedWorkspaceFile,
} from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import { AgentResourceHttpRoutes } from "../Resources/AgentResourceContract.js";

export interface AgentWorkspaceResourceHttpApiOptions {
  readonly workspaceRoot: string;
  readonly maxTextBytes: number;
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

type WorkspaceResourceRoute = "resource" | "content";
type WorkspaceResourceKind = "text" | "image" | "binary";

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

  constructor(private readonly options: AgentWorkspaceResourceHttpApiOptions) {
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
        allowedMethods: ["GET", "HEAD", "PUT", "OPTIONS"],
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
      const resourcePath = this.readResourcePath(request);
      if (route === "content") {
        await this.handleContent(request, response, resourcePath);
      } else {
        await this.handleResource(request, response, resourcePath);
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

  private async handleContent(request: IncomingMessage, response: ServerResponse, resourcePath: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new AgentWorkspaceResourceHttpError(405, "method_not_allowed", "Raw resources are read-only.");
    }

    const opened = await this.openRegularFile(resourcePath);
    try {
      const stat = await opened.handle.stat();
      const sample = await readSample(opened, stat.size);
      const mime = await detectMime(opened.target.addressedPath, sample);
      const inline = isBrowserImageMime(mime);
      const etag = formatStatEtag(stat.size, stat.mtimeMs);
      response.writeHead(200, {
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Length": stat.size,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": inline ? mime : BinaryMimeType,
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
    const opened = await this.openRegularFile(resourcePath);
    try {
      const stat = await opened.handle.stat();
      const sample = await readSample(opened, stat.size);
      const mime = await detectMime(opened.target.addressedPath, sample);
      const kind = classifyResource(opened.target.addressedPath, mime, sample);
      const editable = kind === "text" && stat.size <= this.options.maxTextBytes;
      const contentBuffer = editable ? await opened.handle.readFile() : undefined;
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

  private readResourcePath(request: IncomingMessage): string {
    const url = new URL(request.url ?? "/", "http://senera.local");
    const value = url.searchParams.get("path")?.trim();
    if (!value) {
      throw new AgentWorkspaceResourceHttpError(400, "path_required", "A workspace resource path is required.");
    }
    return value;
  }

  private readRoute(request: IncomingMessage): WorkspaceResourceRoute | undefined {
    try {
      const url = new URL(request.url ?? "/", "http://senera.local");
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
