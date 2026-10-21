import type { IncomingMessage, ServerResponse } from "node:http";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import type { AgentSystemExtensionSettingsItem } from "../SystemTools/AgentSystemToolSource.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { carriesAgentSecretScheme } from "../Security/AgentSecretEnvelopeCodec.js";

export const AgentExtensionSecretHttpRoute = "/api/extension-secrets";

export interface AgentExtensionSecretHttpApiOptions {
  readonly configSnapshot: () => AgentSystemConfig;
  readonly systemExtensions: () => readonly AgentSystemExtensionSettingsItem[];
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

/**
 * Reveals one declared system-extension secret for the authenticated settings
 * editor. The ordinary configuration snapshot remains redacted and this
 * endpoint cannot address undeclared or non-secret fields.
 */
export class AgentExtensionSecretHttpApi {
  constructor(private readonly options: AgentExtensionSecretHttpApiOptions) {}

  canHandle(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://senera.local").pathname === AgentExtensionSecretHttpRoute;
    } catch {
      return false;
    }
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "OPTIONS"],
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
    if (request.method !== "GET") {
      this.sendError(response, 405, "method_not_allowed", "Use GET.");
      return;
    }

    const query = new URL(request.url ?? "/", "http://senera.local").searchParams;
    const extensionId = query.get("extensionId")?.trim();
    const path = query.getAll("path");
    if (!extensionId || path.length === 0 || path.some((part) => part.length === 0)) {
      this.sendError(response, 400, "extension_secret_path_required", "An extension id and field path are required.");
      return;
    }

    const extension = this.options.systemExtensions().find((candidate) => candidate.id === extensionId);
    const field = extension?.configuration?.sections
      .flatMap((section) => flattenFields(section.fields))
      .find((candidate) => samePath(candidate.path, path));
    if (!field?.secret || field.type !== "string") {
      this.sendError(response, 404, "extension_secret_not_found", "The requested extension secret was not found.");
      return;
    }

    const configuration = readExtensionConfiguration(this.options.configSnapshot(), extensionId);
    const value = readPath(configuration, path);
    this.sendJson(response, 200, {
      ok: true,
      extensionId,
      path,
      value: typeof value === "string" && !carriesAgentSecretScheme(value) ? value : "",
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Length": Buffer.byteLength(body),
      "Content-Security-Policy": "default-src 'none'",
      "Content-Type": "application/json; charset=utf-8",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  }

  private sendError(response: ServerResponse, statusCode: number, code: string, message: string): void {
    this.sendJson(response, statusCode, { ok: false, error: { code, message } });
  }
}

function readExtensionConfiguration(config: AgentSystemConfig, extensionId: string): unknown {
  const extensions = config.Extensions;
  if (!isRecord(extensions)) return undefined;
  const extension = extensions[extensionId];
  return isRecord(extension) ? extension.Configuration : undefined;
}

function readPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function flattenFields<T extends { readonly itemFields?: readonly T[] }>(fields: readonly T[]): readonly T[] {
  return fields.flatMap((field) => [field, ...flattenFields(field.itemFields ?? [])]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
