import type { IncomingMessage, ServerResponse } from "node:http";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentResourceHttpRoutes } from "../Resources/AgentResourceContract.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { ArtifactMemoryReadArgumentsSchema } from "./AgentArtifactMemoryTypes.js";
import { readAgentArtifactMemoryContent } from "./AgentArtifactMemoryService.js";
import type { AgentArtifactManifestIndexCache } from "./AgentArtifactManifestIndexCache.js";

export interface AgentArtifactMemoryHttpApiOptions {
  readonly artifactManifestIndex?: AgentArtifactManifestIndexCache;
  readonly workspaceRoot: string;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly maxRequestBytes: number;
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

export class AgentArtifactMemoryHttpApi {
  constructor(private readonly options: AgentArtifactMemoryHttpApiOptions) {}

  canHandle(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://senera.local").pathname === AgentResourceHttpRoutes.ArtifactRead;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-Senera-Csrf"],
        isOriginAllowed: (origin, corsRequest) => this.options.isOriginAllowed?.(origin, corsRequest) ?? false,
      })
    ) {
      this.send(response, 403, { ok: false, error: { code: "forbidden_origin" } });
      return;
    }

    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }
    if (request.method !== "POST") {
      this.send(response, 405, { ok: false, error: { code: "method_not_allowed" } });
      return;
    }

    try {
      const parsed = ArtifactMemoryReadArgumentsSchema.safeParse(
        await readJsonBody(request, this.options.maxRequestBytes),
      );
      if (!parsed.success) {
        this.send(response, 400, {
          ok: false,
          error: {
            code: "invalid_request",
            message: "Artifact read arguments are invalid.",
            issues: parsed.error.issues,
          },
        });
        return;
      }

      const result = await readAgentArtifactMemoryContent(parsed.data, {
        artifactManifestIndex: this.options.artifactManifestIndex,
        workspaceRoot: this.options.workspaceRoot,
        config: this.options.configSnapshot(),
      });
      this.send(response, 200, { ok: true, ...result });
    } catch (error) {
      const status = error instanceof ArtifactMemoryHttpError ? error.status : 500;
      const code = error instanceof ArtifactMemoryHttpError ? error.code : "artifact_read_failed";
      this.send(response, status, { ok: false, error: { code, message: errorMessage(error) } });
    }
  }

  private send(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(value));
  }
}

class ArtifactMemoryHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new ArtifactMemoryHttpError(413, "request_too_large", "Artifact read request is too large.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown;
  } catch {
    throw new ArtifactMemoryHttpError(400, "invalid_json", "Artifact read request must be valid JSON.");
  }
}
