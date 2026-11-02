import type { IncomingMessage, ServerResponse } from "node:http";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { AgentResourceHttpRoutes } from "../Resources/AgentResourceContract.js";
import {
  AgentProfileAvatarIdentities,
  AgentProfileAvatarLimits,
  type AgentProfileAvatarIdentity,
  AgentProfileAvatarStore,
} from "./AgentProfileAvatarStore.js";

const SupportedImageMimes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export interface AgentProfileAvatarHttpApiOptions {
  readonly store: AgentProfileAvatarStore;
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

export class AgentProfileAvatarHttpApi {
  constructor(private readonly options: AgentProfileAvatarHttpApiOptions) {}

  canHandle(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://senera.local").pathname === AgentResourceHttpRoutes.ProfileAvatar;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-Senera-Csrf"],
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
    if (request.method !== "POST") {
      this.sendError(response, 405, "method_not_allowed", "Use POST.");
      return;
    }

    try {
      const identity = readIdentity(request);
      const mime = readMime(request.headers["content-type"]);
      if (!mime || !SupportedImageMimes.has(mime)) {
        throw new AgentProfileAvatarHttpError(
          415,
          "avatar_mime_not_supported",
          "The profile avatar format is not supported.",
        );
      }
      const bytes = await readBody(request, AgentProfileAvatarLimits.MaxBytes);
      const avatarPath = await this.options.store.save(identity, bytes, mime);
      this.sendJson(response, 200, { ok: true, avatarPath, mime });
    } catch (error) {
      const failure =
        error instanceof AgentProfileAvatarHttpError
          ? error
          : new AgentProfileAvatarHttpError(500, "avatar_upload_failed", "The profile avatar could not be saved.");
      this.sendError(response, failure.statusCode, failure.code, failure.message);
    }
  }

  private sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
  }

  private sendError(response: ServerResponse, statusCode: number, code: string, message: string): void {
    this.sendJson(response, statusCode, { ok: false, error: { code, message } });
  }
}

class AgentProfileAvatarHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function readIdentity(request: IncomingMessage): AgentProfileAvatarIdentity {
  const value = new URL(request.url ?? "/", "http://senera.local").searchParams.get("identity");
  if (value === AgentProfileAvatarIdentities.User || value === AgentProfileAvatarIdentities.Assistant) return value;
  throw new AgentProfileAvatarHttpError(400, "avatar_identity_invalid", "A profile avatar identity is required.");
}

function readMime(value: string | string[] | undefined): string | undefined {
  const header = typeof value === "string" ? value : value?.[0];
  return header?.split(";", 1)[0]?.trim().toLowerCase();
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new AgentProfileAvatarHttpError(413, "avatar_too_large", "The profile avatar is too large.");
    }
    chunks.push(buffer);
  }
  if (total === 0) throw new AgentProfileAvatarHttpError(400, "avatar_empty", "The profile avatar is empty.");
  return Buffer.concat(chunks, total);
}
