import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentModelProviderEndpointConfig } from "../Types/AgentModelConfigTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentConfigSnapshot } from "./AgentConfigService.js";
import {
  AgentConfigSecretContract,
  isAgentConfigRedactedSecret,
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
  if (!endpoints || endpoints.length === 0) return config;
  return {
    ...config,
    ModelProviderEndpoints: endpoints.map(redactAgentProviderEndpointSecrets),
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
  if (!endpoints || endpoints.length === 0) return next;
  const baselineEndpoints = baseline.ModelProviderEndpoints ?? [];
  return {
    ...next,
    ModelProviderEndpoints: endpoints.map((endpoint) =>
      restoreAgentProviderEndpointSecrets(endpoint, baselineEndpoints),
    ),
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
      throw new Error(agentErrorMessage("config.secretPlaceholderApiKeyUnresolved", { providerId: endpoint.Id }));
    }
    Object.assign(restored, { ApiKey: baseline.ApiKey });
  }
  if (redactedHeaderNames.length > 0 && endpoint.Headers) {
    const headers = { ...endpoint.Headers };
    for (const name of redactedHeaderNames) {
      const baselineValue = baseline?.Headers?.[name];
      if (typeof baselineValue !== "string") {
        throw new Error(
          agentErrorMessage("config.secretPlaceholderHeaderUnresolved", {
            providerId: endpoint.Id,
            headerName: name,
          }),
        );
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
