import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline, Transform, type Readable, type TransformCallback } from "node:stream";
import busboy from "busboy";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentUploadError, AgentUploadFailureKinds, type AgentUploadStore } from "./AgentUploadStore.js";
import type { AgentUploadAttachment } from "./AgentUploadTypes.js";

export const AgentUploadHttpRoutes = {
  Uploads: "/api/uploads",
} as const;

export interface AgentUploadHttpApiOptions {
  store: AgentUploadStore;
  isOriginAllowed?: (origin: string) => boolean;
}

export class AgentUploadHttpApi {
  private maintenanceEnabled = false;
  private maintenanceTimer?: NodeJS.Timeout;

  constructor(private readonly options: AgentUploadHttpApiOptions) {}

  startMaintenance(): void {
    if (this.maintenanceEnabled) return;
    this.maintenanceEnabled = true;
    void this.options.store.maintain().catch(() => undefined);
    this.scheduleMaintenance();
  }

  stopMaintenance(): void {
    this.maintenanceEnabled = false;
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
  }

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
          message: agentErrorMessage("upload.methodPostOnly"),
        },
      });
      return;
    }

    try {
      const uploads = await this.collectUploads(request);
      if (uploads.length === 0) {
        throw AgentUploadError.from(AgentUploadFailureKinds.FileMissing);
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
          message: error instanceof AgentUploadError ? error.message : agentErrorMessage("upload.failed"),
        },
      });
    }
  }

  private collectUploads(request: IncomingMessage): Promise<AgentUploadAttachment[]> {
    return new Promise((resolve, reject) => {
      const uploads: Array<Promise<AgentUploadAttachment>> = [];
      const store = this.options.store;
      let collectionError: unknown;
      let completed = false;
      const parser = busboy({
        headers: request.headers,
        defParamCharset: "utf8",
        limits: {
          fileSize: store.maxFileBytes,
          files: store.maxFilesPerRequest,
        },
      });
      const requestLimiter = new UploadRequestByteLimiter(store.maxRequestBytes);

      parser.on("file", (_fieldName, file, info) => {
        if (collectionError) {
          file.resume();
          return;
        }
        file.on("limit", () => {
          file.destroy(AgentUploadError.from(AgentUploadFailureKinds.FileTooLarge));
        });
        uploads.push(
          store
            .save({
              stream: file as Readable,
              originalName: info.filename,
              declaredMime: info.mimeType,
            })
            .catch((error: unknown) => {
              file.resume();
              throw error;
            }),
        );
      });
      parser.on("filesLimit", () => {
        collectionError ??= AgentUploadError.from(AgentUploadFailureKinds.FileCountExceeded);
      });
      request.on("aborted", () => {
        collectionError ??= AgentUploadError.from(AgentUploadFailureKinds.Aborted);
      });

      pipeline(request, requestLimiter, parser, (pipelineError) => {
        if (completed) return;
        completed = true;
        void settleUploadCollection({
          uploads,
          store,
          error: pipelineError instanceof AgentUploadError ? pipelineError : (collectionError ?? pipelineError),
        }).then(resolve, reject);
      });
    });
  }

  private scheduleMaintenance(): void {
    if (!this.maintenanceEnabled) return;
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = undefined;
      void this.options.store
        .maintain()
        .catch(() => undefined)
        .finally(() => this.scheduleMaintenance());
    }, this.options.store.maintenanceIntervalMs);
    this.maintenanceTimer.unref();
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

interface SettleUploadCollectionOptions {
  uploads: readonly Promise<AgentUploadAttachment>[];
  store: AgentUploadStore;
  error?: unknown;
}

async function settleUploadCollection(options: SettleUploadCollectionOptions): Promise<AgentUploadAttachment[]> {
  const results = await Promise.allSettled(options.uploads);
  const uploads = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  const error = options.error ?? rejected?.reason;
  if (!error) return uploads;

  await options.store.deleteMany(uploads.map((upload) => upload.uploadUri));
  throw normalizeUploadError(error);
}

function normalizeUploadError(error: unknown): Error {
  if (error instanceof AgentUploadError) return error;
  if (error instanceof Error && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE") {
    return AgentUploadError.from(AgentUploadFailureKinds.Aborted);
  }
  return error instanceof Error ? error : new Error(String(error));
}

class UploadRequestByteLimiter extends Transform {
  private byteLength = 0;

  constructor(private readonly maxRequestBytes: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.byteLength += chunk.byteLength;
    if (this.byteLength > this.maxRequestBytes) {
      callback(AgentUploadError.from(AgentUploadFailureKinds.RequestTooLarge));
      return;
    }
    callback(null, chunk);
  }
}
