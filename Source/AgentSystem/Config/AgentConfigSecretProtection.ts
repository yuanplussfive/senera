import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentSecretUndecryptableError,
  carriesAgentSecretScheme,
  type AgentSecretEnvelopeCodec,
  type AgentSecretOpenFailure,
} from "../Security/AgentSecretEnvelopeCodec.js";
import {
  createAgentSecretDomain,
  type AgentSecretDomainHandle,
  type AgentSecretDomainOptions,
} from "../Security/AgentSecretDomains.js";
import type { AgentLegacySecretKeyRelocation } from "../Security/AgentSecretKeyRing.js";
import { isAgentConfigSensitiveFieldName, isAgentConfigSensitiveHeaderName } from "./AgentConfigSecretContract.js";

/**
 * A secret this host could not open, identified by the configuration field that holds it so
 * surfaces can point at that field instead of matching on display text.
 */
export type AgentConfigUnresolvedSecret =
  | { readonly kind: "provider_api_key"; readonly providerId: string; readonly reason: AgentSecretOpenFailure }
  | {
      readonly kind: "provider_header";
      readonly providerId: string;
      readonly headerName: string;
      readonly reason: AgentSecretOpenFailure;
    }
  | {
      readonly kind: "extension_secret";
      readonly extensionId: string;
      readonly fieldPath: readonly string[];
      readonly reason: AgentSecretOpenFailure;
    };

/** Omit that keeps every member of a union instead of reducing it to the keys they share. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** One secret slot addressed by its place in the configuration; the failure it produced is added on top. */
type SecretSlotIdentity = DistributiveOmit<AgentConfigUnresolvedSecret, "reason">;

export interface AgentConfigSecretDecodeResult<T> {
  value: T;
  plaintextSecretsFound: boolean;
  protectedSecretsFound: boolean;
  /** Secrets opened with pre-keyring key material or an older envelope, so they should be re-sealed. */
  secretsNeedRewrap: boolean;
  /** Secrets this reveal could not open, reported for the payload it produced and no longer. */
  unresolvedSecrets: readonly AgentConfigUnresolvedSecret[];
}

export class AgentConfigSecretCodec {
  private readonly domain: AgentSecretDomainHandle;
  private readonly secrets: AgentSecretEnvelopeCodec;

  constructor(options: AgentSecretDomainOptions) {
    this.domain = createAgentSecretDomain("config", options);
    this.secrets = this.domain.codec;
  }

  /**
   * Key files this host found outside the keyring while opening its secrets, and whether each one left
   * the directory it was found in. Reporting them is the only way a user learns the key moved.
   */
  relocatedLegacyKeys(): readonly AgentLegacySecretKeyRelocation[] {
    return this.domain.keyRing.relocatedLegacyKeys();
  }

  protectConfig(config: AgentSystemConfig): AgentSystemConfig {
    return this.protectPayload(config) as AgentSystemConfig;
  }

  protectPayload(payload: unknown): unknown {
    if (!isJsonObject(payload)) return payload;
    const endpoints = this.protectEndpoints(payload.ModelProviderEndpoints);
    const extensions = this.transformExtensions(payload.Extensions, (value) =>
      isProtectedSecret(value) ? slotUnchanged(value) : slotSealed(this.secrets.seal(value)),
    );
    if (!endpoints.changed && !extensions.changed) return payload;
    return {
      ...payload,
      ...(endpoints.changed ? { ModelProviderEndpoints: endpoints.value } : {}),
      ...(extensions.changed ? { Extensions: extensions.value } : {}),
    };
  }

  revealConfig(config: AgentSystemConfig): AgentConfigSecretDecodeResult<AgentSystemConfig> {
    return this.revealPayload(config) as AgentConfigSecretDecodeResult<AgentSystemConfig>;
  }

  revealPayload<T>(payload: T): AgentConfigSecretDecodeResult<T> {
    if (!isJsonObject(payload)) return emptyDecodeResult(payload);
    const endpoints = this.revealEndpoints(payload.ModelProviderEndpoints);
    const extensions = this.transformExtensions(payload.Extensions, (value, slot) => this.revealSlot(value, slot));
    const slots = [...endpoints.slots, ...extensions.slots];
    return {
      value: (endpoints.changed || extensions.changed
        ? {
            ...payload,
            ...(endpoints.changed ? { ModelProviderEndpoints: endpoints.value } : {}),
            ...(extensions.changed ? { Extensions: extensions.value } : {}),
          }
        : payload) as T,
      plaintextSecretsFound: slots.some((slot) => slot.plaintext),
      protectedSecretsFound: slots.some((slot) => slot.protected),
      secretsNeedRewrap: slots.some((slot) => slot.needsRewrap),
      unresolvedSecrets: slots.flatMap((slot) => (slot.unresolved ? [slot.unresolved] : [])),
    };
  }

  private protectEndpoints(value: unknown): SecretTransform {
    if (!Array.isArray(value)) return { changed: false, value, slots: [] };
    let changed = false;
    const slots: SecretSlot[] = [];
    const endpoints = value.map((candidate) => {
      if (!isJsonObject(candidate)) return candidate;
      const endpoint = { ...candidate };

      if (typeof candidate.ApiKey === "string" && candidate.ApiKey && !isProtectedSecret(candidate.ApiKey)) {
        const sealed = this.secrets.seal(candidate.ApiKey);
        endpoint.ApiKey = sealed;
        slots.push(slotSealed(sealed));
        changed = true;
      }

      if (isJsonObject(candidate.Headers)) {
        const headers = { ...candidate.Headers };
        for (const [name, entry] of Object.entries(candidate.Headers)) {
          if (typeof entry !== "string" || !entry || !isAgentConfigSensitiveHeaderName(name)) continue;
          if (isProtectedSecret(entry)) {
            slots.push(slotUnchanged(entry));
            continue;
          }
          const sealed = this.secrets.seal(entry);
          headers[name] = sealed;
          slots.push(slotSealed(sealed));
          changed = true;
        }
        endpoint.Headers = headers;
      }
      return endpoint;
    });
    return { changed, value: endpoints, slots };
  }

  private revealEndpoints(value: unknown): SecretTransform {
    if (!Array.isArray(value)) return { changed: false, value, slots: [] };
    let changed = false;
    const slots: SecretSlot[] = [];
    const endpoints = value.map((candidate) => {
      if (!isJsonObject(candidate)) return candidate;
      const providerId = readProviderId(candidate);
      const endpoint = { ...candidate };

      if (typeof candidate.ApiKey === "string" && candidate.ApiKey) {
        const revealed = this.revealSlot(candidate.ApiKey, { kind: "provider_api_key", providerId });
        slots.push(revealed);
        if (revealed.changed) {
          endpoint.ApiKey = revealed.value;
          changed = true;
        }
      }

      if (isJsonObject(candidate.Headers)) {
        const headers = { ...candidate.Headers };
        for (const [name, entry] of Object.entries(candidate.Headers)) {
          if (typeof entry !== "string" || !entry || !isAgentConfigSensitiveHeaderName(name)) continue;
          const revealed = this.revealSlot(entry, { kind: "provider_header", providerId, headerName: name });
          slots.push(revealed);
          if (revealed.changed) {
            headers[name] = revealed.value;
            changed = true;
          }
        }
        endpoint.Headers = headers;
      }
      return endpoint;
    });
    return { changed, value: endpoints, slots };
  }

  /**
   * A secret this release cannot open is left exactly as stored and reported, so one unreadable
   * provider degrades to missing data instead of making the whole configuration unusable.
   */
  private revealSlot(value: string, identity: SecretSlotIdentity): SecretSlot {
    if (!isProtectedSecret(value)) return slotPlaintext(value);
    try {
      const { value: revealed, needsRewrap } = this.secrets.open(
        value,
        describeSecretSlot(identity),
        legacySecretContext(identity),
      );
      return slotRevealed(revealed, needsRewrap);
    } catch (error) {
      if (!(error instanceof AgentSecretUndecryptableError)) throw error;
      return slotUnresolved(value, { ...identity, reason: error.failure });
    }
  }

  private transformExtensions(
    extensions: unknown,
    transform: (value: string, slot: SecretSlotIdentity) => SecretSlot,
  ): SecretTransform {
    if (!isJsonObject(extensions)) return { changed: false, value: extensions, slots: [] };
    const slots: SecretSlot[] = [];
    let changed = false;
    const value = Object.fromEntries(
      Object.entries(extensions).map(([extensionId, extension]) => {
        if (!isJsonObject(extension) || !isJsonObject(extension.Configuration)) return [extensionId, extension];
        const configuration = transformExtensionValue(extension.Configuration, [], (raw, fieldPath) =>
          transform(raw, { kind: "extension_secret", extensionId, fieldPath }),
        );
        slots.push(...configuration.slots);
        changed ||= configuration.changed;
        return [extensionId, configuration.changed ? { ...extension, Configuration: configuration.value } : extension];
      }),
    );
    return { changed, value, slots };
  }
}

interface SecretSlot {
  readonly value: string;
  readonly changed: boolean;
  readonly plaintext: boolean;
  readonly protected: boolean;
  readonly needsRewrap: boolean;
  readonly unresolved?: AgentConfigUnresolvedSecret;
}

interface SecretTransform {
  readonly changed: boolean;
  readonly value: unknown;
  readonly slots: readonly SecretSlot[];
}

function slotSealed(value: string): SecretSlot {
  return { value, changed: true, plaintext: true, protected: false, needsRewrap: false };
}

function slotUnchanged(value: string): SecretSlot {
  return { value, changed: false, plaintext: false, protected: true, needsRewrap: false };
}

function slotPlaintext(value: string): SecretSlot {
  return { value, changed: false, plaintext: true, protected: false, needsRewrap: false };
}

function slotRevealed(value: string, needsRewrap: boolean): SecretSlot {
  return { value, changed: true, plaintext: false, protected: true, needsRewrap };
}

function slotUnresolved(value: string, unresolved: AgentConfigUnresolvedSecret): SecretSlot {
  return { value, changed: false, plaintext: false, protected: true, needsRewrap: false, unresolved };
}

function emptyDecodeResult<T>(value: T): AgentConfigSecretDecodeResult<T> {
  return {
    value,
    plaintextSecretsFound: false,
    protectedSecretsFound: false,
    secretsNeedRewrap: false,
    unresolvedSecrets: [],
  };
}

function transformExtensionValue(
  value: unknown,
  path: readonly string[],
  transform: (value: string, path: readonly string[]) => SecretSlot,
): SecretTransform {
  if (Array.isArray(value)) {
    const slots: SecretSlot[] = [];
    let changed = false;
    const mapped = value.map((item, index) => {
      const result = transformExtensionValue(item, [...path, String(index)], transform);
      slots.push(...result.slots);
      changed ||= result.changed;
      return result.value;
    });
    return { changed, value: mapped, slots };
  }
  if (!isJsonObject(value)) return { changed: false, value, slots: [] };

  const slots: SecretSlot[] = [];
  let changed = false;
  const mapped = Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      const fieldPath = [...path, name];
      if (typeof item === "string" && item && isAgentConfigSensitiveFieldName(name)) {
        const result = transform(item, fieldPath);
        slots.push(result);
        changed ||= result.changed;
        return [name, result.value];
      }
      const result = transformExtensionValue(item, fieldPath, transform);
      slots.push(...result.slots);
      changed ||= result.changed;
      return [name, result.value];
    }),
  );
  return { changed, value: mapped, slots };
}

/** Names the slot in decrypt failures and logs, where no locale has been chosen yet. */
function describeSecretSlot(identity: SecretSlotIdentity): string {
  switch (identity.kind) {
    case "provider_api_key":
      return `API key for provider ${identity.providerId}`;
    case "provider_header":
      return `header ${identity.headerName} for provider ${identity.providerId}`;
    case "extension_secret":
      return `secret for extension ${identity.extensionId} configuration ${identity.fieldPath.join(".")}`;
  }
}

/**
 * Authenticated data written by releases before the keyring, which bound each envelope to the
 * identity of the slot holding it. Renaming a provider or moving a field strands these.
 */
function legacySecretContext(identity: SecretSlotIdentity): string {
  switch (identity.kind) {
    case "provider_api_key":
      return providerSecretContext(identity.providerId, "ApiKey");
    case "provider_header":
      return providerSecretContext(
        identity.providerId,
        `Headers/${encodeURIComponent(identity.headerName.toLowerCase())}`,
      );
    case "extension_secret":
      return extensionSecretContext(identity.extensionId, identity.fieldPath);
  }
}

function providerSecretContext(providerId: string, fieldPath: string): string {
  return `senera/config/ModelProviderEndpoints/${providerId}/${fieldPath}`;
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

/**
 * Stored secret material is recognised by its scheme, not by whether this release can parse it, so a
 * truncated or future-versioned envelope is reported instead of being re-sealed as a typed key.
 */
function isProtectedSecret(value: string): boolean {
  return carriesAgentSecretScheme(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
