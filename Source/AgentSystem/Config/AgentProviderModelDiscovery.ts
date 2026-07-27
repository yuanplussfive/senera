import { isDeepStrictEqual } from "node:util";
import type {
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
  ResolvedAgentModelProviderEndpointConfig,
} from "../Types/AgentConfigTypes.js";
import {
  resolveModelProviderEndpointCatalog,
  resolveStandaloneModelProviderEndpointConfig,
} from "../Defaults/AgentModelProviderDefaults.js";
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
  requestIdentity: ProviderModelsRequestIdentity;
  snapshot: AgentProviderModelSnapshot;
}

type ProviderModelsRequestIdentity = Pick<
  ResolvedAgentModelProviderEndpointConfig,
  "Kind" | "BaseUrl" | "ApiKey" | "ApiVersion" | "Headers"
>;

const DISCOVERY_TIMEOUT_MS = 20_000;

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
      ? resolveStandaloneModelProviderEndpointConfig({ ...input.endpoint, Id: input.providerId })
      : this.resolveEndpoint(input.providerId);
    // Reject disabled/unconfigured endpoints before consulting the cache — a
    // warm cache must not mask an endpoint that can no longer be queried.
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

    const requestIdentity = providerModelsRequestIdentity(endpoint);
    const cached = this.cache.get(endpoint.Id);
    if (!input.force && cached && isDeepStrictEqual(cached.requestIdentity, requestIdentity)) {
      return {
        ...cached.snapshot,
        source: "cache",
      };
    }

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await this.fetchImpl(modelsUrl(endpoint.BaseUrl), {
        method: "GET",
        headers: providerHeaders(endpoint),
        // Unreachable endpoints must not hang the request (and the UI spinner)
        // for undici's multi-minute default timeout.
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          agentErrorMessage("model.listRequestFailed", {
            providerId: endpoint.Id,
            status: 408,
            statusText: "timeout",
          }),
          { cause: error },
        );
      }
      throw error;
    }

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
      requestIdentity,
      snapshot,
    });
    return snapshot;
  }

  private resolveEndpoint(providerId: string): ResolvedAgentModelProviderEndpointConfig {
    return resolveModelProviderEndpointCatalog(this.options.configSnapshot()).resolve(providerId);
  }
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

function providerHeaders(endpoint: ResolvedAgentModelProviderEndpointConfig): Headers {
  const headers = new Headers(endpoint.Headers);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  const apiKey = endpoint.ApiKey.trim();
  if (apiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${apiKey}`);
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

function providerModelsRequestIdentity(
  endpoint: ResolvedAgentModelProviderEndpointConfig,
): ProviderModelsRequestIdentity {
  return {
    Kind: endpoint.Kind,
    BaseUrl: endpoint.BaseUrl,
    ApiKey: endpoint.ApiKey,
    ApiVersion: endpoint.ApiVersion,
    Headers: { ...endpoint.Headers },
  };
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
