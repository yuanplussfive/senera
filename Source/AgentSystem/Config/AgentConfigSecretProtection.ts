import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { isFileExistsError, isMissingFileError } from "../Core/AgentFs.js";
import { isAgentConfigSensitiveHeaderName } from "./AgentConfigSecretContract.js";

const SecretEnvelopePrefix = "senera:secret:v1:";
const SecretKeyEnvironmentVariable = "SENERA_CONFIG_SECRET_KEY";
const SecretKeyBytes = 32;
const SecretNonceBytes = 12;

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
  private key?: Buffer;
  private readonly environment: NodeJS.ProcessEnv;
  readonly keyPath: string;

  constructor(options: AgentConfigSecretCodecOptions) {
    this.key = options.key ? validateSecretKey(options.key) : undefined;
    this.environment = options.environment ?? process.env;
    this.keyPath = path.join(path.resolve(options.workspaceRoot), ".senera", "config-secrets.key");
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
    const nonce = randomBytes(SecretNonceBytes);
    const cipher = createCipheriv("aes-256-gcm", this.readKey(true), nonce);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SecretEnvelopePrefix}${nonce.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  private decrypt(envelope: string, context: string, label: string): string {
    const segments = envelope.slice(SecretEnvelopePrefix.length).split(".");
    if (segments.length !== 3 || segments.some((segment) => !segment)) {
      throw new Error(`Invalid encrypted configuration secret envelope for ${label}.`);
    }

    try {
      const [nonceText, tagText, ciphertextText] = segments;
      const nonce = Buffer.from(nonceText, "base64url");
      const tag = Buffer.from(tagText, "base64url");
      const ciphertext = Buffer.from(ciphertextText, "base64url");
      if (nonce.length !== SecretNonceBytes || tag.length !== 16) {
        throw new Error("Invalid nonce or authentication tag length.");
      }
      const decipher = createDecipheriv("aes-256-gcm", this.readKey(false), nonce);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      const missingKeyDetail =
        error instanceof Error && error.message.startsWith("Configuration secret key is missing:")
          ? ` ${error.message}`
          : "";
      throw new Error(
        `Unable to decrypt ${label}. Check ${SecretKeyEnvironmentVariable} or ${this.keyPath}.${missingKeyDetail}`,
        { cause: error },
      );
    }
  }

  private readKey(createIfMissing: boolean): Buffer {
    if (this.key) {
      return this.key;
    }

    const environmentKey = this.environment[SecretKeyEnvironmentVariable]?.trim();
    if (environmentKey) {
      this.key = decodeSecretKey(environmentKey, SecretKeyEnvironmentVariable);
      return this.key;
    }

    this.key = createIfMissing ? readOrCreateLocalSecretKey(this.keyPath) : readLocalSecretKey(this.keyPath);
    return this.key;
  }
}

export function resolveAgentConfigSecretWorkspaceRoot(databasePath: string): string {
  const directory = path.dirname(path.resolve(databasePath));
  return path.basename(directory).toLowerCase() === ".senera" ? path.dirname(directory) : directory;
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
  return value.startsWith(SecretEnvelopePrefix);
}

function readOrCreateLocalSecretKey(keyPath: string): Buffer {
  try {
    return decodeSecretKey(fs.readFileSync(keyPath, "utf8").trim(), keyPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const generatedKey = randomBytes(SecretKeyBytes);
  try {
    fs.writeFileSync(keyPath, `${generatedKey.toString("base64url")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    restrictFilePermissions(keyPath);
    return generatedKey;
  } catch (error) {
    if (!isFileExistsError(error)) {
      throw error;
    }
    return decodeSecretKey(fs.readFileSync(keyPath, "utf8").trim(), keyPath);
  }
}

function readLocalSecretKey(keyPath: string): Buffer {
  try {
    return decodeSecretKey(fs.readFileSync(keyPath, "utf8").trim(), keyPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Configuration secret key is missing: ${keyPath}.`, { cause: error });
    }
    throw error;
  }
}

function decodeSecretKey(encoded: string, source: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== SecretKeyBytes) {
    throw new Error(`${source} must contain a base64url-encoded 32-byte key.`);
  }
  return key;
}

function validateSecretKey(key: Buffer): Buffer {
  if (key.length !== SecretKeyBytes) {
    throw new Error("Agent configuration secret key must be 32 bytes.");
  }
  return Buffer.from(key);
}

function restrictFilePermissions(filePath: string): void {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
