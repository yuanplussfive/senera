import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentModelProviderEndpointConfig } from "../Types/AgentModelConfigTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentConfigSnapshot } from "./AgentConfigService.js";
import {
  AgentConfigSecretContract,
  isAgentConfigRedactedSecret,
  isAgentConfigSensitiveFieldName,
  isAgentConfigSensitiveHeaderName,
} from "./AgentConfigSecretContract.js";
import { projectAgentConfigForm } from "./AgentConfigFormProjector.js";

/**
 * 密钥只存在于 ModelProviderEndpoints：ApiKey 与可能承载凭证的请求头。
 * 快照离开进程边界前替换为占位符；回写时凭占位符按端点 Id 还原真实值，
 * 因此密钥永远不会进入前端内存，也不会因为用户保存配置而被占位符覆盖。
 */

interface AgentEndpointSecretFields {
  Id: string;
  ApiKey?: string | null;
  Headers?: Record<string, string> | null;
}

export function redactAgentSystemConfigSecrets(config: AgentSystemConfig): AgentSystemConfig {
  const endpoints = config.ModelProviderEndpoints;
  const extensions = redactExtensionConfigurationSecrets(config.Extensions);
  const hasEndpoints = Boolean(endpoints?.length);
  if (!hasEndpoints && !extensions.changed) return config;
  return {
    ...config,
    ...(hasEndpoints ? { ModelProviderEndpoints: endpoints?.map(redactAgentProviderEndpointSecrets) } : {}),
    ...(extensions.changed ? { Extensions: extensions.value as AgentSystemConfig["Extensions"] } : {}),
  };
}

export function redactAgentConfigSnapshotSecrets(snapshot: AgentConfigSnapshot): AgentConfigSnapshot {
  const value = redactAgentSystemConfigSecrets(snapshot.value);
  if (value === snapshot.value) return snapshot;
  return {
    ...snapshot,
    value,
    form: projectAgentConfigForm(value),
  };
}

export function restoreAgentSystemConfigSecrets(
  next: AgentSystemConfig,
  baseline: AgentSystemConfig,
): AgentSystemConfig {
  const endpoints = next.ModelProviderEndpoints;
  const baselineEndpoints = baseline.ModelProviderEndpoints ?? [];
  const extensions = restoreExtensionConfigurationSecrets(next.Extensions, baseline.Extensions);
  const hasEndpoints = Boolean(endpoints?.length);
  if (!hasEndpoints && !extensions.changed) return next;
  return {
    ...next,
    ...(hasEndpoints
      ? {
          ModelProviderEndpoints: endpoints?.map((endpoint) =>
            restoreAgentProviderEndpointSecrets(endpoint, baselineEndpoints),
          ),
        }
      : {}),
    ...(extensions.changed ? { Extensions: extensions.value as AgentSystemConfig["Extensions"] } : {}),
  };
}

export function restoreAgentProviderEndpointSecrets<Endpoint extends AgentEndpointSecretFields>(
  endpoint: Endpoint,
  baselineEndpoints: readonly AgentModelProviderEndpointConfig[],
): Endpoint {
  const hasRedactedApiKey = isAgentConfigRedactedSecret(endpoint.ApiKey);
  const redactedHeaderNames = Object.entries(endpoint.Headers ?? {})
    .filter(([, value]) => isAgentConfigRedactedSecret(value))
    .map(([name]) => name);
  if (!hasRedactedApiKey && redactedHeaderNames.length === 0) return endpoint;

  const baseline = baselineEndpoints.find((candidate) => candidate.Id === endpoint.Id);
  const restored = { ...endpoint };
  if (hasRedactedApiKey) {
    if (typeof baseline?.ApiKey !== "string" || baseline.ApiKey.length === 0) {
      throw new AgentLocalizedError("config.secretPlaceholderApiKeyUnresolved", { providerId: endpoint.Id });
    }
    Object.assign(restored, { ApiKey: baseline.ApiKey });
  }
  if (redactedHeaderNames.length > 0 && endpoint.Headers) {
    const headers = { ...endpoint.Headers };
    for (const name of redactedHeaderNames) {
      const baselineValue = baseline?.Headers?.[name];
      if (typeof baselineValue !== "string") {
        throw new AgentLocalizedError("config.secretPlaceholderHeaderUnresolved", {
          providerId: endpoint.Id,
          headerName: name,
        });
      }
      headers[name] = baselineValue;
    }
    Object.assign(restored, { Headers: headers });
  }
  return restored;
}

function redactAgentProviderEndpointSecrets(
  endpoint: AgentModelProviderEndpointConfig,
): AgentModelProviderEndpointConfig {
  const redacted = { ...endpoint };
  if (typeof endpoint.ApiKey === "string" && endpoint.ApiKey.length > 0) {
    redacted.ApiKey = AgentConfigSecretContract.RedactedPlaceholder;
  }
  if (endpoint.Headers) {
    redacted.Headers = Object.fromEntries(
      Object.entries(endpoint.Headers).map(([name, value]) => [
        name,
        value.length > 0 && isAgentConfigSensitiveHeaderName(name)
          ? AgentConfigSecretContract.RedactedPlaceholder
          : value,
      ]),
    );
  }
  return redacted;
}

interface ExtensionConfigurationResult {
  readonly value: unknown;
  readonly changed: boolean;
}

function redactExtensionConfigurationSecrets(extensions: unknown): ExtensionConfigurationResult {
  if (!isRecord(extensions)) return { value: extensions, changed: false };
  let changed = false;
  const value = Object.fromEntries(
    Object.entries(extensions).map(([extensionId, extension]) => {
      if (!isRecord(extension) || !isRecord(extension.Configuration)) return [extensionId, extension];
      const configuration = redactConfigurationSecrets(extension.Configuration);
      changed ||= configuration.changed;
      return [extensionId, configuration.changed ? { ...extension, Configuration: configuration.value } : extension];
    }),
  );
  return { value: changed ? value : extensions, changed };
}

function restoreExtensionConfigurationSecrets(next: unknown, baseline: unknown): ExtensionConfigurationResult {
  if (!isRecord(next)) return { value: next, changed: false };
  const baselineExtensions = isRecord(baseline) ? baseline : {};
  let changed = false;
  const value = Object.fromEntries(
    Object.entries(next).map(([extensionId, extension]) => {
      if (!isRecord(extension) || !isRecord(extension.Configuration)) return [extensionId, extension];
      const baselineExtension = baselineExtensions[extensionId];
      const baselineConfiguration = isRecord(baselineExtension) ? baselineExtension.Configuration : undefined;
      const configuration = restoreConfigurationSecrets(
        extension.Configuration,
        baselineConfiguration,
        extensionId,
        [],
      );
      changed ||= configuration.changed;
      return [extensionId, configuration.changed ? { ...extension, Configuration: configuration.value } : extension];
    }),
  );
  return { value: changed ? value : next, changed };
}

function redactConfigurationSecrets(value: unknown): ExtensionConfigurationResult {
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = redactConfigurationSecrets(item);
      changed ||= next.changed;
      return next.value;
    });
    return { value: changed ? mapped : value, changed };
  }
  if (!isRecord(value)) return { value, changed: false };
  let changed = false;
  const mapped = Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      if (typeof item === "string" && item && isAgentConfigSensitiveFieldName(name)) {
        changed = true;
        return [name, AgentConfigSecretContract.RedactedPlaceholder];
      }
      const next = redactConfigurationSecrets(item);
      changed ||= next.changed;
      return [name, next.value];
    }),
  );
  return { value: changed ? mapped : value, changed };
}

function restoreConfigurationSecrets(
  value: unknown,
  baseline: unknown,
  extensionId: string,
  path: readonly string[],
): ExtensionConfigurationResult {
  if (Array.isArray(value)) {
    const baselineItems = Array.isArray(baseline) ? baseline : [];
    let changed = false;
    const mapped = value.map((item, index) => {
      const next = restoreConfigurationSecrets(item, baselineItems[index], extensionId, [...path, String(index)]);
      changed ||= next.changed;
      return next.value;
    });
    return { value: changed ? mapped : value, changed };
  }
  if (!isRecord(value)) return { value, changed: false };
  const baselineRecord = isRecord(baseline) ? baseline : {};
  let changed = false;
  const mapped = Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      const fieldPath = [...path, name];
      if (typeof item === "string" && isAgentConfigSensitiveFieldName(name) && isAgentConfigRedactedSecret(item)) {
        const stored = baselineRecord[name];
        if (typeof stored !== "string" || !stored) {
          throw new Error(
            `Secret placeholder for extension ${extensionId} configuration ${fieldPath.join(".")} cannot be resolved.`,
          );
        }
        changed = true;
        return [name, stored];
      }
      const next = restoreConfigurationSecrets(item, baselineRecord[name], extensionId, fieldPath);
      changed ||= next.changed;
      return [name, next.value];
    }),
  );
  return { value: changed ? mapped : value, changed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
