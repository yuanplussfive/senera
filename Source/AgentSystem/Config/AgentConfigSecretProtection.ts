import path from "node:path";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { findAgentWorkspaceRoot, resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentSecretEnvelopeCodec, isAgentSecretEnvelope } from "../Security/AgentSecretEnvelopeCodec.js";
import { isAgentConfigSensitiveHeaderName } from "./AgentConfigSecretContract.js";

const SecretKeyEnvironmentVariable = "SENERA_CONFIG_SECRET_KEY";

export interface AgentConfigSecretDecodeResult<T> {
  value: T;
  plaintextSecretsFound: boolean;
  protectedSecretsFound: boolean;
}

export interface AgentConfigSecretCodecOptions {
  workspaceRoot: string;
  key?: Buffer;
  environment?: NodeJS.ProcessEnv;
}

export class AgentConfigSecretCodec {
  private readonly secrets: AgentSecretEnvelopeCodec;
  readonly keyPath: string;

  constructor(options: AgentConfigSecretCodecOptions) {
    this.keyPath = resolveAgentWorkspaceLayout(options.workspaceRoot).configSecretKey;
    this.secrets = new AgentSecretEnvelopeCodec({
      keyPath: this.keyPath,
      keyEnvironmentVariable: SecretKeyEnvironmentVariable,
      key: options.key,
      environment: options.environment,
      keyLabel: "Configuration secret key",
    });
  }

  protectConfig(config: AgentSystemConfig): AgentSystemConfig {
    return this.protectPayload(config) as AgentSystemConfig;
  }

  protectPayload(payload: unknown): unknown {
    if (!isJsonObject(payload) || !Array.isArray(payload.ModelProviderEndpoints)) {
      return payload;
    }

    let changed = false;
    const endpoints = payload.ModelProviderEndpoints.map((candidate) => {
      if (!isJsonObject(candidate)) return candidate;
      const providerId = readProviderId(candidate);
      let endpointChanged = false;
      const protectedEndpoint = { ...candidate };

      if (typeof candidate.ApiKey === "string" && candidate.ApiKey && !isProtectedSecret(candidate.ApiKey)) {
        protectedEndpoint.ApiKey = this.encrypt(candidate.ApiKey, providerSecretContext(providerId, "ApiKey"));
        endpointChanged = true;
      }

      if (isJsonObject(candidate.Headers)) {
        const protectedHeaders = { ...candidate.Headers };
        for (const [name, value] of Object.entries(candidate.Headers)) {
          if (
            typeof value === "string" &&
            value &&
            isAgentConfigSensitiveHeaderName(name) &&
            !isProtectedSecret(value)
          ) {
            protectedHeaders[name] = this.encrypt(
              value,
              providerSecretContext(providerId, `Headers/${encodeURIComponent(name.toLowerCase())}`),
            );
            endpointChanged = true;
          }
        }
        if (endpointChanged) protectedEndpoint.Headers = protectedHeaders;
      }

      changed ||= endpointChanged;
      return endpointChanged ? protectedEndpoint : candidate;
    });

    return changed ? { ...payload, ModelProviderEndpoints: endpoints } : payload;
  }

  revealConfig(config: AgentSystemConfig): AgentConfigSecretDecodeResult<AgentSystemConfig> {
    return this.revealPayload(config) as AgentConfigSecretDecodeResult<AgentSystemConfig>;
  }

  digestCanonicalJson(value: unknown, context: string): string {
    return this.secrets.digest(stringifyAgentCanonicalJson(value), `senera/config/${context}`);
  }

  revealPayload<T>(payload: T): AgentConfigSecretDecodeResult<T> {
    if (!isJsonObject(payload) || !Array.isArray(payload.ModelProviderEndpoints)) {
      return { value: payload, plaintextSecretsFound: false, protectedSecretsFound: false };
    }

    let changed = false;
    let plaintextSecretsFound = false;
    let protectedSecretsFound = false;
    const endpoints = payload.ModelProviderEndpoints.map((candidate) => {
      if (!isJsonObject(candidate)) return candidate;
      const providerId = readProviderId(candidate);
      let endpointChanged = false;
      const revealedEndpoint = { ...candidate };

      if (typeof candidate.ApiKey === "string" && candidate.ApiKey) {
        if (isProtectedSecret(candidate.ApiKey)) {
          protectedSecretsFound = true;
          revealedEndpoint.ApiKey = this.decrypt(
            candidate.ApiKey,
            providerSecretContext(providerId, "ApiKey"),
            `API key for provider ${providerId}`,
          );
          endpointChanged = true;
        } else {
          plaintextSecretsFound = true;
        }
      }

      if (isJsonObject(candidate.Headers)) {
        const revealedHeaders = { ...candidate.Headers };
        for (const [name, value] of Object.entries(candidate.Headers)) {
          if (typeof value !== "string" || !value || !isAgentConfigSensitiveHeaderName(name)) continue;
          if (isProtectedSecret(value)) {
            protectedSecretsFound = true;
            revealedHeaders[name] = this.decrypt(
              value,
              providerSecretContext(providerId, `Headers/${encodeURIComponent(name.toLowerCase())}`),
              `header ${name} for provider ${providerId}`,
            );
            endpointChanged = true;
          } else {
            plaintextSecretsFound = true;
          }
        }
        if (endpointChanged) revealedEndpoint.Headers = revealedHeaders;
      }

      changed ||= endpointChanged;
      return endpointChanged ? revealedEndpoint : candidate;
    });

    return {
      value: (changed ? { ...payload, ModelProviderEndpoints: endpoints } : payload) as T,
      plaintextSecretsFound,
      protectedSecretsFound,
    };
  }

  private encrypt(value: string, context: string): string {
    return this.secrets.seal(value, context);
  }

  private decrypt(envelope: string, context: string, label: string): string {
    return this.secrets.open(envelope, context, label);
  }
}

export function resolveAgentConfigSecretWorkspaceRoot(databasePath: string): string {
  const directory = path.dirname(path.resolve(databasePath));
  return findAgentWorkspaceRoot(directory) ?? directory;
}

function providerSecretContext(providerId: string, fieldPath: string): string {
  return `senera/config/ModelProviderEndpoints/${providerId}/${fieldPath}`;
}

function readProviderId(endpoint: Record<string, unknown>): string {
  if (typeof endpoint.Id !== "string" || !endpoint.Id) {
    throw new Error("Cannot protect or reveal provider credentials without ModelProviderEndpoints[].Id.");
  }
  return endpoint.Id;
}

function isProtectedSecret(value: string): boolean {
  return isAgentSecretEnvelope(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
