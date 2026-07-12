import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import busboy from "busboy";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentUploadError, type AgentUploadStore } from "./AgentUploadStore.js";
import type { AgentUploadAttachment } from "./AgentUploadTypes.js";

export const AgentUploadHttpRoutes = {
  Uploads: "/api/uploads",
} as const;

export interface AgentUploadHttpApiOptions {
  storeFactory: () => AgentUploadStore;
  isOriginAllowed?: (origin: string) => boolean;
}

export class AgentUploadHttpApi {
  constructor(private readonly options: AgentUploadHttpApiOptions) {}

  canHandle(request: IncomingMessage): boolean {
    return this.readPathname(request) === AgentUploadHttpRoutes.Uploads;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["POST", "OPTIONS"],
        isOriginAllowed: (origin) => this.options.isOriginAllowed?.(origin) ?? false,
      })
    ) {
      this.sendJson(response, 403, {
        ok: false,
        error: {
          code: "forbidden_origin",
          message: agentErrorMessage("auth.requestDenied"),
        },
      });
      return;
    }

    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }

    if (request.method !== "POST") {
      this.sendJson(response, 405, {
        ok: false,
        error: {
          code: "method_not_allowed",
          message: "上传接口只支持 POST。",
        },
      });
      return;
    }

    try {
      const uploads = await this.collectUploads(request);
      if (uploads.length === 0) {
        throw new AgentUploadError("请求里没有文件。", "upload_file_missing", 400);
      }

      this.sendJson(response, 200, {
        ok: true,
        uploads,
      });
    } catch (error) {
      const statusCode = error instanceof AgentUploadError ? error.statusCode : 500;
      this.sendJson(response, statusCode, {
        ok: false,
        error: {
          code: error instanceof AgentUploadError ? error.code : "upload_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private collectUploads(request: IncomingMessage): Promise<AgentUploadAttachment[]> {
    return new Promise((resolve, reject) => {
      const uploads: Array<Promise<AgentUploadAttachment>> = [];
      const store = this.options.storeFactory();
      const parser = busboy({
        headers: request.headers,
        defParamCharset: "utf8",
        limits: {
          fileSize: store.maxFileBytes,
        },
      });

      parser.on("file", (_fieldName, file, info) => {
        file.on("limit", () => {
          file.destroy(new AgentUploadError("上传文件超过大小限制。", "upload_too_large", 413));
        });
        uploads.push(
          store.save({
            stream: file as Readable,
            originalName: info.filename,
            declaredMime: info.mimeType,
          }),
        );
      });
      parser.on("error", reject);
      parser.on("finish", () => {
        Promise.all(uploads).then(resolve, reject);
      });
      request.on("aborted", () => {
        reject(new AgentUploadError("上传连接已中断。", "upload_aborted", 499));
      });
      request.pipe(parser);
    });
  }

  private readPathname(request: IncomingMessage): string {
    return new URL(request.url ?? "/", "http://senera.local").pathname;
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
  }
}
