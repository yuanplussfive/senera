import { sha256Hex } from "../Core/AgentHash.js";
import { decodeWebBody, fetchWebResource } from "./AgentWebHttpClient.js";
import type { AgentWebToolsConfiguration } from "./AgentWebConfiguration.js";
import { extractAgentWebContent } from "./AgentWebContentExtractor.js";
import {
  createAgentWebSearchProvider,
  filterAndCiteSearchResults,
  type AgentWebSearchProvider,
} from "./AgentWebSearchProviders.js";
import type {
  AgentWebFetchOutput,
  AgentWebFetchRequest,
  AgentWebRuntime,
  AgentWebRuntimeOptions,
  AgentWebSearchOutput,
  AgentWebSearchRequest,
} from "./AgentWebTypes.js";

interface SearchCacheEntry {
  readonly expiresAt: number;
  readonly value: AgentWebSearchOutput;
}

export class DefaultAgentWebRuntime implements AgentWebRuntime {
  private readonly provider: AgentWebSearchProvider;
  private readonly searchCache = new Map<string, SearchCacheEntry>();
  private readonly now: () => number;

  constructor(
    readonly configuration: AgentWebToolsConfiguration,
    options: AgentWebRuntimeOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.provider = createAgentWebSearchProvider({
      configuration,
      fetchImpl: options.fetchImpl,
      resolveHostAddresses: options.resolveHostAddresses,
    });
    this.fetchImpl = options.fetchImpl;
    this.resolveHostAddresses = options.resolveHostAddresses;
  }

  private readonly fetchImpl?: typeof fetch;
  private readonly resolveHostAddresses?: (hostname: string) => Promise<readonly string[]>;

  async search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchOutput> {
    const normalized = normalizeSearchRequest(
      input,
      this.configuration.search.maxMaxResults,
      this.configuration.search.requestTimeoutMs,
      this.configuration.search.maxOperationTimeoutMs,
    );
    const { timeoutMs: _timeoutMs, ...cacheableRequest } = normalized;
    const cacheKey = JSON.stringify({ provider: this.provider.id, ...cacheableRequest });
    const cached = this.searchCache.get(cacheKey);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      this.searchCache.delete(cacheKey);
      this.searchCache.set(cacheKey, cached);
      return cached.value;
    }
    if (cached) this.searchCache.delete(cacheKey);

    const raw = await this.provider.search(normalized, signal);
    const results = filterAndCiteSearchResults(raw, normalized);
    const output = { query: normalized.query, results } satisfies AgentWebSearchOutput;
    const ttl = this.configuration.search.cacheTtlSeconds * 1_000;
    if (ttl > 0 && this.configuration.search.cacheMaxEntries > 0) {
      this.searchCache.set(cacheKey, { expiresAt: now + ttl, value: output });
      while (this.searchCache.size > this.configuration.search.cacheMaxEntries) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest === undefined) break;
        this.searchCache.delete(oldest);
      }
    }
    return output;
  }

  async fetch(input: AgentWebFetchRequest, signal?: AbortSignal): Promise<AgentWebFetchOutput> {
    const maxBytes = resolveBoundedMaxBytes(input.maxBytes, this.configuration.fetch.responseMaxBytes);
    const timeoutMs = resolveOperationTimeout(
      input.timeoutMs,
      this.configuration.fetch.requestTimeoutMs,
      this.configuration.fetch.maxOperationTimeoutMs,
    );
    const response = await fetchWebResource(
      input.url,
      {
        maxRedirects: this.configuration.fetch.maxRedirects,
        responseMaxBytes: maxBytes,
        timeoutMs,
        userAgent: this.configuration.fetch.userAgent,
        maxUrlLength: this.configuration.fetch.maxUrlLength,
        allowPrivateNetworks: this.configuration.fetch.allowPrivateNetworks,
        allowSyntheticProxyAddresses: this.configuration.fetch.allowSyntheticProxyAddresses,
        fetchImpl: this.fetchImpl,
        resolveHostAddresses: this.resolveHostAddresses,
      },
      signal,
    );
    const source = decodeResponseBody(response.body, response.contentType);
    const extracted = extractAgentWebContent({
      source,
      contentType: response.contentType,
      finalUrl: response.url,
      mode: input.contentMode,
      extractPrompt: input.extractPrompt,
      maxExtractBlocks: this.configuration.fetch.maxExtractBlocks,
      maxMarkdownChars: this.configuration.fetch.markdownMaxChars,
      maxLinks: this.configuration.fetch.maxLinks,
    });
    const content = appendTruncationNotice(extracted.markdown, response.transfer);
    const markdownSummary = appendTruncationNotice(extracted.markdownSummary, response.transfer);
    const citationId = `citation_${sha256Hex(`${response.url}\n${content}`).slice(0, 16)}`;
    return {
      title: extracted.title,
      finalUrl: response.url,
      markdownSummary,
      content,
      links: extracted.links,
      citationId,
      transfer: response.transfer,
    };
  }
}

function appendTruncationNotice(value: string, transfer: AgentWebFetchOutput["transfer"]): string {
  if (!transfer.truncated) return value;
  const notice = `...[Source response truncated after ${transfer.receivedBytes} bytes; increase maxBytes for more content.]`;
  return value ? `${value}\n\n${notice}` : notice;
}

function normalizeSearchRequest(
  input: AgentWebSearchRequest,
  maxMaxResults: number,
  defaultTimeoutMs: number,
  maxOperationTimeoutMs: number,
): AgentWebSearchRequest {
  return {
    query: input.query.trim(),
    allowedDomains: normalizeDomains(input.allowedDomains),
    blockedDomains: normalizeDomains(input.blockedDomains),
    freshness: input.freshness,
    maxResults: Math.max(1, Math.min(Math.floor(input.maxResults), maxMaxResults)),
    timeoutMs: resolveOperationTimeout(input.timeoutMs, defaultTimeoutMs, maxOperationTimeoutMs),
  };
}

function resolveOperationTimeout(
  value: number | undefined,
  defaultTimeoutMs: number | undefined,
  maximum: number,
): number {
  if (value === undefined) {
    if (defaultTimeoutMs === undefined) return maximum;
    return defaultTimeoutMs;
  }
  if (!Number.isInteger(value) || value < 1_000 || value > maximum) {
    throw new Error(`Web timeoutMs must be an integer between 1000 and ${maximum}.`);
  }
  return value;
}

function normalizeDomains(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeDomain(value)).filter(Boolean))];
}

function normalizeDomain(value: string): string {
  const source = value.trim().toLowerCase();
  if (!source) return "";
  try {
    const parsed = source.includes("://") ? new URL(source) : new URL(`https://${source}`);
    return parsed.hostname.toLowerCase().replace(/^\*\./u, "");
  } catch {
    return source.replace(/^\*\./u, "").replace(/^\.+|\.+$/gu, "");
  }
}

function resolveBoundedMaxBytes(value: number | undefined, configured: number): number {
  if (value === undefined) return configured;
  return Math.max(1, Math.min(Math.floor(value), configured));
}

function decodeResponseBody(body: Uint8Array, contentType: string): string {
  return decodeWebBody(body, contentType);
}
