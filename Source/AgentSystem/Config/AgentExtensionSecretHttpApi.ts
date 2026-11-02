import type { IncomingMessage, ServerResponse } from "node:http";
import {
  acceptAgentPrivateJsonGet,
  sendAgentPrivateJson,
  sendAgentPrivateJsonError,
} from "../Web/AgentPrivateJsonHttp.js";
import type { AgentSystemExtensionSettingsItem } from "../SystemTools/AgentSystemToolSource.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentConfigFormField } from "../Types/ConfigFormTypes.js";
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
    if (!acceptAgentPrivateJsonGet(request, response, this.options.isOriginAllowed)) return;

    const query = new URL(request.url ?? "/", "http://senera.local").searchParams;
    const extensionId = query.get("extensionId")?.trim();
    const path = query.getAll("path");
    if (!extensionId || path.length === 0 || path.some((part) => part.length === 0)) {
      sendAgentPrivateJsonError(
        response,
        400,
        "extension_secret_path_required",
        "An extension id and field path are required.",
      );
      return;
    }

    const extension = this.options.systemExtensions().find((candidate) => candidate.id === extensionId);
    const field = extension?.configuration?.sections
      .map((section) => findField(section.fields, path))
      .find((candidate) => candidate !== undefined);
    if (!field?.secret || field.type !== "string") {
      sendAgentPrivateJsonError(
        response,
        404,
        "extension_secret_not_found",
        "The requested extension secret was not found.",
      );
      return;
    }

    const configuration = readExtensionConfiguration(this.options.configSnapshot(), extensionId);
    const value = readPath(configuration, path);
    if (typeof value === "string" && carriesAgentSecretScheme(value)) {
      sendAgentPrivateJsonError(
        response,
        409,
        "secret_unresolved",
        "This host cannot decrypt the saved secret, so it cannot be revealed. Enter it again.",
      );
      return;
    }
    sendAgentPrivateJson(response, 200, {
      ok: true,
      extensionId,
      path,
      value: typeof value === "string" ? value : "",
    });
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
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function findField<TText>(
  fields: readonly AgentConfigFormField<TText>[],
  path: readonly string[],
  parentPath: readonly string[] = [],
): AgentConfigFormField<TText> | undefined {
  for (const field of fields) {
    const relativePath = field.path.slice(parentPath.length);
    if (relativePath.length > path.length || !relativePath.every((part, index) => part === path[index])) continue;
    const remaining = path.slice(relativePath.length);
    if (remaining.length === 0) return field;
    const itemPath = field.type === "record" || field.type === "array" ? remaining.slice(1) : remaining;
    const child = findField(field.itemFields ?? [], itemPath, field.path);
    if (child) return child;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
