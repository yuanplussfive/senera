import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import mime from "mime-types";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export interface AgentStaticFrontendHttpApiOptions {
  rootDir: string;
  runtimeConfigFileName?: string;
}

export class AgentStaticFrontendHttpApi {
  private readonly rootDir: string;
  private readonly runtimeConfigFileName: string;

  constructor(options: AgentStaticFrontendHttpApiOptions) {
    this.rootDir = path.resolve(options.rootDir);
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
    const candidate = this.resolveSafePath(requestedPath);
    if (!candidate) {
      return undefined;
    }

    return this.isReadableFile(candidate) ? candidate : undefined;
  }

  private resolveResponseFile(requestedPath: string): string | undefined {
    return (
      this.resolveExistingFile(requestedPath) ?? (isFrontendRoute(requestedPath) ? this.indexFilePath() : undefined)
    );
  }

  private resolveSafePath(requestedPath: string): string | undefined {
    const relative = requestedPath.replace(/^\/+/, "");
    const candidate = path.resolve(this.rootDir, relative);
    return isInsideDirectory(this.rootDir, candidate) ? candidate : undefined;
  }

  private indexFilePath(): string {
    return path.join(this.rootDir, "index.html");
  }

  private isReadableFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  private sendFile(request: IncomingMessage, response: ServerResponse, filePath: string): void {
    response.writeHead(200, {
      "Content-Type": this.readContentType(filePath),
      "Cache-Control": this.readCacheControl(filePath),
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(filePath).pipe(response);
  }

  private readContentType(filePath: string): string {
    return mime.contentType(path.extname(filePath)) || "application/octet-stream";
  }

  private readCacheControl(filePath: string): string {
    const fileName = path.basename(filePath);
    return fileName === "index.html" || fileName === this.runtimeConfigFileName
      ? "no-cache"
      : "public, max-age=31536000, immutable";
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
