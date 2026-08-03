import type {
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
  ResolvedAgentModelProviderEndpointConfig,
} from "../Types/AgentConfigTypes.js";
import {
  resolveModelProviderEndpointCatalog,
  resolveStandaloneModelProviderEndpointConfig,
} from "../Defaults/AgentModelProviderDefaults.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { isAgentUnknownRecord, readAgentTrimmedString } from "../Core/AgentUnknownValue.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

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
  configRevision?: () => number | undefined;
  fetchImpl?: typeof fetch;
  cache?: Partial<AgentProviderModelDiscoveryCachePolicy>;
  now?: () => number;
}

export interface AgentProviderModelDiscoveryCachePolicy {
  readonly maxEntries: number;
  readonly ttlMs: number;
}

interface CachedProviderModels {
  requestIdentity: ProviderModelsRequestIdentity;
  snapshot: AgentProviderModelSnapshot;
  expiresAt: number;
}

type ProviderModelsRequestIdentity = string;

const DISCOVERY_TIMEOUT_MS = 20_000;
export const AgentProviderModelDiscoveryCacheDefaults = {
  MaxEntries: 64,
  TtlMs: 5 * 60_000,
} as const;

export class AgentProviderModelDiscovery {
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CachedProviderModels>();
  private readonly cachePolicy: AgentProviderModelDiscoveryCachePolicy;

  constructor(private readonly options: AgentProviderModelDiscoveryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cachePolicy = resolveDiscoveryCachePolicy(options.cache);
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
      throw new AgentLocalizedError("model.listProviderDisabled", { providerId: endpoint.Id });
    }

    if (!endpoint.BaseUrl.trim()) {
      throw new AgentLocalizedError("model.listBaseUrlEmpty", { providerId: endpoint.Id });
    }

    const configRevision = this.options.configRevision?.();
    const cacheable = shouldCacheProviderModels(input.endpoint, endpoint, configRevision);
    const requestIdentity = providerModelsRequestIdentity(endpoint, configRevision);
    const now = this.now();
    this.pruneExpiredSnapshots(now);
    const cached = this.cache.get(endpoint.Id);
    if (cacheable && !input.force && cached && cached.expiresAt > now && cached.requestIdentity === requestIdentity) {
      this.cache.delete(endpoint.Id);
      this.cache.set(endpoint.Id, cached);
      return {
        ...cloneProviderModelSnapshot(cached.snapshot),
        source: "cache",
      };
    }
    if (cached) this.cache.delete(endpoint.Id);

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
        throw new AgentLocalizedError(
          "model.listRequestFailed",
          {
            providerId: endpoint.Id,
            status: 408,
            statusText: "timeout",
          },
          { cause: error },
        );
      }
      throw error;
    }

    if (!response.ok) {
      throw new AgentLocalizedError("model.listRequestFailed", {
        providerId: endpoint.Id,
        status: response.status,
        statusText: response.statusText,
      });
    }

    const models = parseModelListResponse(await response.json());
    const fetchedAt = this.now();
    const snapshot: AgentProviderModelSnapshot = {
      providerId: endpoint.Id,
      baseUrl: endpoint.BaseUrl,
      fetchedAt: new Date(fetchedAt).toISOString(),
      source: "network",
      models,
    };
    if (cacheable) {
      this.cacheSnapshot(endpoint.Id, {
        requestIdentity,
        snapshot: cloneProviderModelSnapshot(snapshot),
        expiresAt: fetchedAt + this.cachePolicy.ttlMs,
      });
    }
    return cloneProviderModelSnapshot(snapshot);
  }

  private resolveEndpoint(providerId: string): ResolvedAgentModelProviderEndpointConfig {
    return resolveModelProviderEndpointCatalog(this.options.configSnapshot()).resolve(providerId);
  }

  private cacheSnapshot(providerId: string, cached: CachedProviderModels): void {
    if (this.cachePolicy.maxEntries === 0) return;
    while (this.cache.size >= this.cachePolicy.maxEntries) {
      const oldestProviderId = this.cache.keys().next().value;
      if (oldestProviderId === undefined) break;
      this.cache.delete(oldestProviderId);
    }
    this.cache.set(providerId, cached);
  }

  private pruneExpiredSnapshots(now: number): void {
    for (const [providerId, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(providerId);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
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
  if (!isAgentUnknownRecord(value)) {
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
  if (!isAgentUnknownRecord(value)) {
    return null;
  }
  const id =
    readAgentTrimmedString(value.id) ?? readAgentTrimmedString(value.model) ?? readAgentTrimmedString(value.name);
  if (!id) {
    return null;
  }
  return {
    id,
    ownedBy: readAgentTrimmedString(value.owned_by) ?? readAgentTrimmedString(value.ownedBy),
  };
}

function providerModelsRequestIdentity(
  endpoint: ResolvedAgentModelProviderEndpointConfig,
  configRevision: number | undefined,
): ProviderModelsRequestIdentity {
  return sha256HexOfCanonicalJson({
    ConfigRevision: configRevision ?? null,
    Kind: endpoint.Kind,
    BaseUrl: endpoint.BaseUrl,
    ApiVersion: endpoint.ApiVersion,
    HeaderNames: Object.keys(endpoint.Headers).sort((left, right) => left.localeCompare(right)),
  });
}

function shouldCacheProviderModels(
  inputEndpoint: AgentModelProviderEndpointConfig | undefined,
  endpoint: ResolvedAgentModelProviderEndpointConfig,
  configRevision: number | undefined,
): boolean {
  if (inputEndpoint) return !hasEndpointCredentials(endpoint);
  return !hasEndpointCredentials(endpoint) || configRevision !== undefined;
}

function hasEndpointCredentials(endpoint: ResolvedAgentModelProviderEndpointConfig): boolean {
  return endpoint.ApiKey.trim().length > 0 || Object.keys(endpoint.Headers).length > 0;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveDiscoveryCachePolicy(
  input: Partial<AgentProviderModelDiscoveryCachePolicy> | undefined,
): AgentProviderModelDiscoveryCachePolicy {
  const maxEntries = input?.maxEntries ?? AgentProviderModelDiscoveryCacheDefaults.MaxEntries;
  const ttlMs = input?.ttlMs ?? AgentProviderModelDiscoveryCacheDefaults.TtlMs;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw new Error(`Provider discovery cache maxEntries must be a non-negative safe integer: ${maxEntries}`);
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`Provider discovery cache ttlMs must be positive and finite: ${ttlMs}`);
  }
  return { maxEntries, ttlMs };
}

function cloneProviderModelSnapshot(snapshot: AgentProviderModelSnapshot): AgentProviderModelSnapshot {
  return { ...snapshot, models: snapshot.models.map((model) => ({ ...model })) };
}
