import type { IncomingMessage, ServerResponse } from "node:http";
import {
  acceptAgentPrivateJsonGet,
  sendAgentPrivateJson,
  sendAgentPrivateJsonError,
} from "../Web/AgentPrivateJsonHttp.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { carriesAgentSecretScheme } from "../Security/AgentSecretEnvelopeCodec.js";

export const AgentProviderCredentialHttpRoute = "/api/provider-credentials";

export interface AgentProviderCredentialHttpApiOptions {
  readonly configSnapshot: () => AgentSystemConfig;
  readonly isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean;
}

/**
 * Reveals one provider credential only while the authenticated settings UI is
 * editing that provider. General config snapshots remain redacted, so secrets
 * do not enter the event journal or runtime diagnostics. A credential this host could not decrypt
 * still holds its envelope in the snapshot, and handing that to the editor would save the
 * ciphertext back as a literal key, so it is refused instead.
 */
export class AgentProviderCredentialHttpApi {
  constructor(private readonly options: AgentProviderCredentialHttpApiOptions) {}

  canHandle(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://senera.local").pathname === AgentProviderCredentialHttpRoute;
    } catch {
      return false;
    }
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    if (!acceptAgentPrivateJsonGet(request, response, this.options.isOriginAllowed)) return;

    const providerId = new URL(request.url ?? "/", "http://senera.local").searchParams.get("providerId")?.trim();
    if (!providerId) {
      sendAgentPrivateJsonError(response, 400, "provider_id_required", "A provider id is required.");
      return;
    }
    const endpoint = this.options
      .configSnapshot()
      .ModelProviderEndpoints?.find((candidate) => candidate.Id === providerId);
    if (!endpoint) {
      sendAgentPrivateJsonError(response, 404, "provider_not_found", "The provider was not found.");
      return;
    }

    const apiKey = endpoint.ApiKey ?? "";
    if (carriesAgentSecretScheme(apiKey)) {
      sendAgentPrivateJsonError(
        response,
        409,
        "secret_unresolved",
        "This host cannot decrypt the saved API key, so it cannot be revealed. Enter it again.",
      );
      return;
    }

    sendAgentPrivateJson(response, 200, {
      ok: true,
      providerId,
      apiKey,
    });
  }
}
