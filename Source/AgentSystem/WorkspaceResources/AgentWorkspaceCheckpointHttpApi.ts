import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { AgentWorkspaceCheckpointConflictError } from "../Artifacts/AgentWorkspaceCheckpointRecovery.js";
import {
  AgentWorkspaceCheckpointArtifactError,
  AgentWorkspaceCheckpointNotFoundError,
  AgentWorkspaceCheckpointRestoreService,
} from "../Artifacts/AgentWorkspaceCheckpointRestoreService.js";
import { parseAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";
import { AgentResourceHttpRoutes } from "../Resources/AgentResourceContract.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

const WorkspaceCheckpointReferenceSchema = z
  .object({
    artifactUri: z
      .string()
      .trim()
      .min(1)
      .refine((value) => parseAgentArtifactUri(value) !== undefined, "Expected a valid Senera Artifact URI."),
    checkpointId: z.string().trim().min(1),
  })
  .strict();

const WorkspaceCheckpointUndoRequestSchema = z
  .object({ checkpoints: z.array(WorkspaceCheckpointReferenceSchema).min(1) })
  .strict();

export interface AgentWorkspaceCheckpointHttpApiOptions {
  readonly workspaceRoot: string;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly artifactManifestIndex?: AgentArtifactManifestIndexCache;
  readonly maxRequestBytes: number;
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

/**
 * A user-confirmed undo surface for a precise, published workspace checkpoint.
 * Its transport deliberately accepts neither a target snapshot nor arbitrary
 * paths: the only operation is restoring the checkpoint's verified `before`
 * image after validating that its `after` image is still live.
 */
export class AgentWorkspaceCheckpointHttpApi {
  private readonly manifestIndex: AgentArtifactManifestIndexCache;

  constructor(private readonly options: AgentWorkspaceCheckpointHttpApiOptions) {
    this.manifestIndex = options.artifactManifestIndex ?? new AgentArtifactManifestIndexCache();
  }

  canHandle(request: IncomingMessage): boolean {
    return (
      new URL(request.url ?? "/", "http://senera.local").pathname === AgentResourceHttpRoutes.WorkspaceCheckpointUndo
    );
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
      const parsed = WorkspaceCheckpointUndoRequestSchema.safeParse(
        await readJsonBody(request, this.options.maxRequestBytes),
      );
      if (!parsed.success) {
        this.send(response, 400, { ok: false, error: { code: "invalid_request", issues: parsed.error.issues } });
        return;
      }
      const result = await new AgentWorkspaceCheckpointRestoreService({
        workspaceRoot: this.options.workspaceRoot,
        config: this.options.configSnapshot(),
        manifestIndex: this.manifestIndex,
      }).undoMany(parsed.data.checkpoints);
      this.send(response, 200, { ok: true, result });
    } catch (error) {
      const failure = projectWorkspaceCheckpointUndoError(error);
      this.send(response, failure.status, { ok: false, error: { code: failure.code, message: failure.message } });
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

class WorkspaceCheckpointHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function projectWorkspaceCheckpointUndoError(error: unknown): WorkspaceCheckpointHttpError {
  if (error instanceof WorkspaceCheckpointHttpError) return error;
  if (error instanceof AgentWorkspaceCheckpointConflictError) {
    return new WorkspaceCheckpointHttpError(409, "workspace_changed", error.message);
  }
  if (error instanceof AgentWorkspaceCheckpointNotFoundError) {
    return new WorkspaceCheckpointHttpError(404, "checkpoint_not_found", error.message);
  }
  if (error instanceof AgentWorkspaceCheckpointArtifactError) {
    return new WorkspaceCheckpointHttpError(422, "checkpoint_artifact_invalid", error.message);
  }
  return new WorkspaceCheckpointHttpError(500, "checkpoint_undo_failed", errorMessage(error));
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new WorkspaceCheckpointHttpError(413, "request_too_large", "Workspace checkpoint request is too large.");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown;
  } catch {
    throw new WorkspaceCheckpointHttpError(400, "invalid_json", "Workspace checkpoint request must be valid JSON.");
  }
}
