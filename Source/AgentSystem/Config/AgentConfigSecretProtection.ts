import path from "node:path";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { findAgentWorkspaceRoot, resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentSecretEnvelopeCodec, isAgentSecretEnvelope } from "../Security/AgentSecretEnvelopeCodec.js";
import { isAgentConfigSensitiveFieldName, isAgentConfigSensitiveHeaderName } from "./AgentConfigSecretContract.js";

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
    if (!isJsonObject(payload)) return payload;

    let changed = false;
    const endpoints = Array.isArray(payload.ModelProviderEndpoints)
      ? payload.ModelProviderEndpoints.map((candidate) => {
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
        })
      : undefined;
    const extensions = this.protectExtensionConfigurationSecrets(payload.Extensions);
    changed ||= extensions.changed;

    return changed
      ? {
          ...payload,
          ...(endpoints ? { ModelProviderEndpoints: endpoints } : {}),
          ...(extensions.changed ? { Extensions: extensions.value } : {}),
        }
      : payload;
  }

  revealConfig(config: AgentSystemConfig): AgentConfigSecretDecodeResult<AgentSystemConfig> {
    return this.revealPayload(config) as AgentConfigSecretDecodeResult<AgentSystemConfig>;
  }

  digestCanonicalJson(value: unknown, context: string): string {
    return this.secrets.digest(stringifyAgentCanonicalJson(value), `senera/config/${context}`);
  }

  revealPayload<T>(payload: T): AgentConfigSecretDecodeResult<T> {
    if (!isJsonObject(payload)) return { value: payload, plaintextSecretsFound: false, protectedSecretsFound: false };

    let changed = false;
    let plaintextSecretsFound = false;
    let protectedSecretsFound = false;
    const endpoints = Array.isArray(payload.ModelProviderEndpoints)
      ? payload.ModelProviderEndpoints.map((candidate) => {
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
        })
      : undefined;
    const extensions = this.revealExtensionConfigurationSecrets(payload.Extensions);
    changed ||= extensions.changed;
    plaintextSecretsFound ||= extensions.plaintextSecretsFound;
    protectedSecretsFound ||= extensions.protectedSecretsFound;

    return {
      value: (changed
        ? {
            ...payload,
            ...(endpoints ? { ModelProviderEndpoints: endpoints } : {}),
            ...(extensions.changed ? { Extensions: extensions.value } : {}),
          }
        : payload) as T,
      plaintextSecretsFound,
      protectedSecretsFound,
    };
  }

  private protectExtensionConfigurationSecrets(value: unknown): ExtensionSecretTransformResult {
    return transformExtensionConfigurationSecrets(value, (secret, extensionId, path) => {
      if (isProtectedSecret(secret)) return { value: secret, changed: false, plaintext: false, protected: true };
      return {
        value: this.encrypt(secret, extensionSecretContext(extensionId, path)),
        changed: true,
        plaintext: true,
        protected: false,
      };
    });
  }

  private revealExtensionConfigurationSecrets(value: unknown): ExtensionSecretTransformResult {
    return transformExtensionConfigurationSecrets(value, (secret, extensionId, path) => {
      if (!isProtectedSecret(secret)) return { value: secret, changed: false, plaintext: true, protected: false };
      return {
        value: this.decrypt(
          secret,
          extensionSecretContext(extensionId, path),
          `secret for extension ${extensionId} configuration ${path.join(".")}`,
        ),
        changed: true,
        plaintext: false,
        protected: true,
      };
    });
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

interface ExtensionSecretTransformResult {
  readonly value: unknown;
  readonly changed: boolean;
  readonly plaintextSecretsFound: boolean;
  readonly protectedSecretsFound: boolean;
}

interface ExtensionSecretValueTransformResult {
  readonly value: string;
  readonly changed: boolean;
  readonly plaintext: boolean;
  readonly protected: boolean;
}

function transformExtensionConfigurationSecrets(
  extensions: unknown,
  transform: (value: string, extensionId: string, path: readonly string[]) => ExtensionSecretValueTransformResult,
): ExtensionSecretTransformResult {
  if (!isJsonObject(extensions)) {
    return { value: extensions, changed: false, plaintextSecretsFound: false, protectedSecretsFound: false };
  }
  let changed = false;
  let plaintextSecretsFound = false;
  let protectedSecretsFound = false;
  const result = Object.fromEntries(
    Object.entries(extensions).map(([extensionId, extension]) => {
      if (!isJsonObject(extension) || !isJsonObject(extension.Configuration)) return [extensionId, extension];
      const configuration = transformExtensionConfigurationValue(extension.Configuration, extensionId, [], transform);
      changed ||= configuration.changed;
      plaintextSecretsFound ||= configuration.plaintextSecretsFound;
      protectedSecretsFound ||= configuration.protectedSecretsFound;
      return [extensionId, configuration.changed ? { ...extension, Configuration: configuration.value } : extension];
    }),
  );
  return {
    value: changed ? result : extensions,
    changed,
    plaintextSecretsFound,
    protectedSecretsFound,
  };
}

function transformExtensionConfigurationValue(
  value: unknown,
  extensionId: string,
  path: readonly string[],
  transform: (value: string, extensionId: string, path: readonly string[]) => ExtensionSecretValueTransformResult,
): ExtensionSecretTransformResult {
  if (Array.isArray(value)) {
    let changed = false;
    let plaintextSecretsFound = false;
    let protectedSecretsFound = false;
    const mapped = value.map((item, index) => {
      const next = transformExtensionConfigurationValue(item, extensionId, [...path, String(index)], transform);
      changed ||= next.changed;
      plaintextSecretsFound ||= next.plaintextSecretsFound;
      protectedSecretsFound ||= next.protectedSecretsFound;
      return next.value;
    });
    return { value: changed ? mapped : value, changed, plaintextSecretsFound, protectedSecretsFound };
  }
  if (!isJsonObject(value)) {
    return { value, changed: false, plaintextSecretsFound: false, protectedSecretsFound: false };
  }

  let changed = false;
  let plaintextSecretsFound = false;
  let protectedSecretsFound = false;
  const mapped = Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      if (typeof item === "string" && item && isAgentConfigSensitiveFieldName(name)) {
        const next = transform(item, extensionId, [...path, name]);
        changed ||= next.changed;
        plaintextSecretsFound ||= next.plaintext;
        protectedSecretsFound ||= next.protected;
        return [name, next.value];
      }
      const next = transformExtensionConfigurationValue(item, extensionId, [...path, name], transform);
      changed ||= next.changed;
      plaintextSecretsFound ||= next.plaintextSecretsFound;
      protectedSecretsFound ||= next.protectedSecretsFound;
      return [name, next.value];
    }),
  );
  return {
    value: changed ? mapped : value,
    changed,
    plaintextSecretsFound,
    protectedSecretsFound,
  };
}

function extensionSecretContext(extensionId: string, path: readonly string[]): string {
  const segments = ["Extensions", extensionId, "Configuration", ...path].map((part) => encodeURIComponent(part));
  return `senera/config/${segments.join("/")}`;
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
