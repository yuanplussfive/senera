import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import mime from "mime-types";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  isAgentStaticAssetSidecar,
  readAgentStaticAssetSidecarSuffix,
  selectAgentStaticAssetContentEncoding,
  type AgentStaticAssetContentEncoding,
} from "./AgentStaticAssetEncoding.js";

export interface AgentStaticFrontendHttpApiOptions {
  rootDir: string;
  runtimeConfigFileName?: string;
}

export class AgentStaticFrontendHttpApi {
  private readonly rootDir: string;
  private readonly canonicalRootDir: string;
  private readonly runtimeConfigFileName: string;

  constructor(options: AgentStaticFrontendHttpApiOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.canonicalRootDir = fs.realpathSync(this.rootDir);
    this.runtimeConfigFileName = options.runtimeConfigFileName ?? "senera-runtime-config.js";
  }

  canHandle(request: IncomingMessage): boolean {
    return (request.method === "GET" || request.method === "HEAD") && !this.isApiRoute(request);
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    const requestedPath = this.resolveRequestedPath(request);
    if (!requestedPath) {
      this.sendNotFound(response);
      return;
    }

    const targetPath = this.resolveResponseFile(requestedPath);
    if (!targetPath) {
      this.sendNotFound(response);
      return;
    }

    this.sendFile(request, response, targetPath);
  }

  private resolveRequestedPath(request: IncomingMessage): string | undefined {
    const pathname = new URL(request.url ?? "/", "http://senera.local").pathname;
    const decoded = safeDecodePathname(pathname);
    if (decoded === undefined) {
      return undefined;
    }

    return decoded === "/" ? "/index.html" : decoded;
  }

  private isApiRoute(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://senera.local").pathname.startsWith("/api/");
  }

  private resolveExistingFile(requestedPath: string): string | undefined {
    if (isAgentStaticAssetSidecar(requestedPath)) return undefined;
    const candidate = this.resolveSafePath(requestedPath);
    return candidate ? this.resolveCanonicalReadableFile(candidate) : undefined;
  }

  private resolveCanonicalReadableFile(candidate: string): string | undefined {
    if (!this.isReadableFile(candidate)) return undefined;
    try {
      const canonicalCandidate = fs.realpathSync(candidate);
      return isInsideDirectory(this.canonicalRootDir, canonicalCandidate) ? canonicalCandidate : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveResponseFile(requestedPath: string): string | undefined {
    return (
      this.resolveExistingFile(requestedPath) ??
      (isFrontendRoute(requestedPath) ? this.resolveExistingFile("/index.html") : undefined)
    );
  }

  private resolveSafePath(requestedPath: string): string | undefined {
    const relative = requestedPath.replace(/^\/+/, "");
    const candidate = path.resolve(this.rootDir, relative);
    return isInsideDirectory(this.rootDir, candidate) ? candidate : undefined;
  }

  private isReadableFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  private sendFile(request: IncomingMessage, response: ServerResponse, filePath: string): void {
    const representation = this.resolveRepresentation(request, filePath);
    const byteLength = fs.statSync(representation.filePath).size;
    response.writeHead(200, {
      "Content-Type": this.readContentType(filePath),
      "Cache-Control": this.readCacheControl(filePath),
      "Content-Length": byteLength,
      Vary: "Accept-Encoding",
      ...(representation.contentEncoding ? { "Content-Encoding": representation.contentEncoding } : {}),
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(representation.filePath).pipe(response);
  }

  private resolveRepresentation(
    request: IncomingMessage,
    filePath: string,
  ): { filePath: string; contentEncoding?: AgentStaticAssetContentEncoding } {
    const representationByEncoding = new Map<AgentStaticAssetContentEncoding, string>();
    const contentEncoding = selectAgentStaticAssetContentEncoding(request.headers["accept-encoding"], (candidate) => {
      const representationPath = this.resolveCanonicalReadableFile(
        `${filePath}${readAgentStaticAssetSidecarSuffix(candidate)}`,
      );
      if (representationPath) representationByEncoding.set(candidate, representationPath);
      return Boolean(representationPath);
    });
    const representationPath = contentEncoding ? representationByEncoding.get(contentEncoding) : undefined;
    return contentEncoding && representationPath ? { filePath: representationPath, contentEncoding } : { filePath };
  }

  private readContentType(filePath: string): string {
    return mime.contentType(path.extname(filePath)) || "application/octet-stream";
  }

  private readCacheControl(filePath: string): string {
    const fileName = path.basename(filePath);
    if (fileName === this.runtimeConfigFileName) return "no-store";
    return fileName === "index.html" ? "no-cache" : "public, max-age=31536000, immutable";
  }

  private sendNotFound(response: ServerResponse): void {
    response.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          code: "not_found",
          message: agentErrorMessage("websocket.frontendAssetMissing"),
        },
      }),
    );
  }
}

function isInsideDirectory(rootDir: string, candidate: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeDecodePathname(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function isFrontendRoute(requestedPath: string): boolean {
  return path.extname(requestedPath).length === 0;
}
