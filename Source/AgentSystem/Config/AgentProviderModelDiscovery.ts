import type {
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
  ResolvedAgentModelProviderEndpointConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveModelProviderEndpointCatalog } from "../Defaults/AgentModelProviderDefaults.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export interface AgentProviderModelInfo {
  id: string;
  ownedBy?: string;
}

export interface AgentProviderModelSnapshot {
  providerId: string;
  baseUrl: string;
  fetchedAt: string;
  source: "cache" | "network";
  models: AgentProviderModelInfo[];
}

export interface AgentProviderModelDiscoveryOptions {
  configSnapshot: () => AgentSystemConfig;
  fetchImpl?: typeof fetch;
}

interface CachedProviderModels {
  fingerprint: string;
  snapshot: AgentProviderModelSnapshot;
}

export class AgentProviderModelDiscovery {
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CachedProviderModels>();

  constructor(private readonly options: AgentProviderModelDiscoveryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listProviderModels(input: {
    providerId: string;
    force?: boolean;
    endpoint?: AgentModelProviderEndpointConfig;
  }): Promise<AgentProviderModelSnapshot> {
    const endpoint = input.endpoint
      ? resolveConfiguredEndpoint({ ...input.endpoint, Id: input.providerId })
      : this.resolveEndpoint(input.providerId);
    const fingerprint = endpointFingerprint(endpoint);
    const cached = this.cache.get(endpoint.Id);
    if (!input.force && cached?.fingerprint === fingerprint) {
      return {
        ...cached.snapshot,
        source: "cache",
      };
    }

    if (!endpoint.Enabled) {
      throw new Error(
        agentErrorMessage("model.listProviderDisabled", {
          providerId: endpoint.Id,
        }),
      );
    }

    if (!endpoint.BaseUrl.trim()) {
      throw new Error(
        agentErrorMessage("model.listBaseUrlEmpty", {
          providerId: endpoint.Id,
        }),
      );
    }

    const response = await this.fetchImpl(modelsUrl(endpoint.BaseUrl), {
      method: "GET",
      headers: providerHeaders(endpoint),
    });

    if (!response.ok) {
      throw new Error(
        agentErrorMessage("model.listRequestFailed", {
          providerId: endpoint.Id,
          status: response.status,
          statusText: response.statusText,
        }),
      );
    }

    const snapshot: AgentProviderModelSnapshot = {
      providerId: endpoint.Id,
      baseUrl: endpoint.BaseUrl,
      fetchedAt: new Date().toISOString(),
      source: "network",
      models: parseModelListResponse(await response.json()),
    };
    this.cache.set(endpoint.Id, {
      fingerprint,
      snapshot,
    });
    return snapshot;
  }

  private resolveEndpoint(providerId: string): ResolvedAgentModelProviderEndpointConfig {
    const config = this.options.configSnapshot();
    const direct = config.ModelProviderEndpoints?.find((endpoint) => endpoint.Id === providerId);
    return direct ? resolveConfiguredEndpoint(direct) : resolveModelProviderEndpointCatalog(config).resolve(providerId);
  }
}

function resolveConfiguredEndpoint(
  endpoint: AgentModelProviderEndpointConfig,
): ResolvedAgentModelProviderEndpointConfig {
  return {
    Id: endpoint.Id,
    Icon: endpoint.Icon ?? "",
    Enabled: endpoint.Enabled ?? true,
    Kind: endpoint.Kind ?? "OpenAICompatible",
    BaseUrl: endpoint.BaseUrl ?? "",
    ApiKey: endpoint.ApiKey ?? "",
    ApiVersion: endpoint.ApiVersion ?? "2023-06-01",
    Headers: { ...(endpoint.Headers ?? {}) },
  };
}

function modelsUrl(baseUrl: string): URL {
  const url = new URL(withTrailingSlash(baseUrl));
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] !== "models") {
    segments.push("models");
  }
  url.pathname = segments.join("/");
  return url;
}

function providerHeaders(endpoint: ResolvedAgentModelProviderEndpointConfig): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...endpoint.Headers,
  };
  if (endpoint.ApiKey.trim()) {
    headers.Authorization = `Bearer ${endpoint.ApiKey}`;
  }
  return headers;
}

function parseModelListResponse(value: unknown): AgentProviderModelInfo[] {
  const source = readModelArray(value);
  const seen = new Set<string>();
  const models: AgentProviderModelInfo[] = [];
  for (const item of source) {
    const model = parseModelInfo(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

function readModelArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  if (Array.isArray(value.data)) {
    return value.data;
  }
  if (Array.isArray(value.models)) {
    return value.models;
  }
  return [];
}

function parseModelInfo(value: unknown): AgentProviderModelInfo | null {
  if (typeof value === "string" && value.trim()) {
    return { id: value.trim() };
  }
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id) ?? readString(value.model) ?? readString(value.name);
  if (!id) {
    return null;
  }
  return {
    id,
    ownedBy: readString(value.owned_by) ?? readString(value.ownedBy),
  };
}

function endpointFingerprint(endpoint: ResolvedAgentModelProviderEndpointConfig): string {
  return JSON.stringify({
    kind: endpoint.Kind,
    baseUrl: endpoint.BaseUrl,
    apiVersion: endpoint.ApiVersion,
    headers: endpoint.Headers,
  });
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
