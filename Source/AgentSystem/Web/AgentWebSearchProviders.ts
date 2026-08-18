import { AgentBaseError } from "../Core/AgentBaseError.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { sha256Hex } from "../Core/AgentHash.js";
import { parseHTML } from "linkedom";
import { AgentWebHttpError, requestWebResource, decodeWebBody } from "./AgentWebHttpClient.js";
import type { AgentWebToolsConfiguration } from "./AgentWebConfiguration.js";
import type { AgentWebSearchFreshness, AgentWebSearchProviderResult, AgentWebSearchRequest } from "./AgentWebTypes.js";

export interface AgentWebSearchProviderOptions {
  readonly configuration: AgentWebToolsConfiguration;
  readonly fetchImpl?: typeof fetch;
  readonly resolveHostAddresses?: (hostname: string) => Promise<readonly string[]>;
}

export class AgentWebSearchError extends AgentBaseError {
  constructor(
    readonly code: "provider_not_configured" | "invalid_response" | "provider_failed" | "rate_limited",
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface AgentWebSearchProvider {
  readonly id: AgentWebToolsConfiguration["search"]["provider"];
  search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]>;
}

export function createAgentWebSearchProvider(options: AgentWebSearchProviderOptions): AgentWebSearchProvider {
  const providerId = options.configuration.search.provider;
  switch (providerId) {
    case "exa":
      return new ExaSearchProvider(options);
    case "tavily":
      return new TavilySearchProvider(options);
    case "brave":
      return new BraveSearchProvider(options);
    case "duckduckgo":
      return new DuckDuckGoSearchProvider(options);
    case "searxng":
      return new SearxngSearchProvider(options);
  }
}

abstract class HttpSearchProvider implements AgentWebSearchProvider {
  abstract readonly id: AgentWebSearchProvider["id"];

  constructor(protected readonly options: AgentWebSearchProviderOptions) {}

  abstract search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]>;

  protected async get(
    endpoint: string,
    query: URLSearchParams,
    timeoutMs: number,
    signal?: AbortSignal,
    headers?: Readonly<Record<string, string>>,
  ) {
    const url = new URL(endpoint);
    url.search = query.toString();
    return requestWebResource(url.toString(), this.httpOptions(timeoutMs), { method: "GET", headers }, signal);
  }

  protected async getJson(
    endpoint: string,
    query: URLSearchParams,
    timeoutMs: number,
    signal?: AbortSignal,
    headers?: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const response = await this.get(endpoint, query, timeoutMs, signal, headers);
    return parseJsonResponse(response.url, response.body, response.contentType);
  }

  protected async postJson(
    endpoint: string,
    body: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
    headers?: Readonly<Record<string, string>>,
  ) {
    return requestWebResource(
      endpoint,
      this.httpOptions(timeoutMs),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(body),
      },
      signal,
    );
  }

  protected async postJsonResponse(
    endpoint: string,
    body: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
    headers?: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const response = await this.postJson(endpoint, body, timeoutMs, signal, headers);
    return parseJsonResponse(response.url, response.body, response.contentType);
  }

  protected endpoint(defaultEndpoint: string, requiresConfiguration = false): string {
    const configured = this.options.configuration.search.endpoint.trim();
    if (configured) return configured;
    if (requiresConfiguration) {
      throw new AgentWebSearchError(
        "provider_not_configured",
        `Search provider ${this.id} requires an endpoint in the web-tools configuration.`,
        { provider: this.id },
      );
    }
    return defaultEndpoint;
  }

  protected httpOptions(timeoutMs: number) {
    const search = this.options.configuration.search;
    return {
      maxRedirects: this.options.configuration.fetch.maxRedirects,
      responseMaxBytes: search.responseMaxBytes,
      timeoutMs,
      userAgent: this.options.configuration.fetch.userAgent,
      fetchImpl: this.options.fetchImpl,
      resolveHostAddresses: this.options.resolveHostAddresses,
      allowPrivateNetworks: search.allowPrivateNetworks,
      allowSyntheticProxyAddresses: search.allowSyntheticProxyAddresses,
      maxUrlLength: this.options.configuration.fetch.maxUrlLength,
    };
  }

  protected requireApiKey(key: "tavilyApiKey" | "braveApiKey"): string {
    const apiKey = this.options.configuration.search[key].trim();
    if (apiKey) return apiKey;
    throw new AgentWebSearchError(
      "provider_not_configured",
      `Search provider ${this.id} requires an access key in the web-tools configuration.`,
      { provider: this.id },
    );
  }
}

class ExaSearchProvider extends HttpSearchProvider {
  readonly id = "exa" as const;

  override async search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]> {
    try {
      const apiKey = this.options.configuration.search.exaApiKey.trim();
      return apiKey ? await this.searchWithApi(apiKey, input, signal) : await this.searchWithRemoteMcp(input, signal);
    } catch (error) {
      throw normalizeProviderError(this.id, error);
    }
  }

  private async searchWithApi(
    apiKey: string,
    input: AgentWebSearchRequest,
    signal?: AbortSignal,
  ): Promise<AgentWebSearchProviderResult[]> {
    const data = await this.postJsonResponse(
      this.endpoint("https://api.exa.ai/search"),
      {
        query: input.query,
        type: "auto",
        numResults: input.maxResults,
        ...exaDomainFilters(input),
        ...(input.freshness === "any" ? {} : { startPublishedDate: freshnessStartDate(input.freshness) }),
        contents: { highlights: true },
      },
      input.timeoutMs ?? this.options.configuration.search.requestTimeoutMs,
      signal,
      { "x-api-key": apiKey },
    );
    return projectSearchResults(readResultArray(data, ["results"]));
  }

  private async searchWithRemoteMcp(
    input: AgentWebSearchRequest,
    signal?: AbortSignal,
  ): Promise<AgentWebSearchProviderResult[]> {
    const tool = "web_search_advanced_exa";
    const response = await this.postJson(
      this.endpoint(`https://mcp.exa.ai/mcp?tools=${tool}`),
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: tool,
          arguments: {
            query: input.query,
            numResults: input.maxResults,
            ...exaDomainFilters(input),
            ...(input.freshness === "any" ? {} : { startPublishedDate: freshnessStartDate(input.freshness) }),
            textMaxCharacters: 4_000,
          },
        },
      },
      input.timeoutMs ?? this.options.configuration.search.requestTimeoutMs,
      signal,
      { "x-exa-source": "senera" },
    );
    return projectSearchResults(readResultArray(parseExaMcpSearchResponse(response), ["results"]));
  }
}

class TavilySearchProvider extends HttpSearchProvider {
  readonly id = "tavily" as const;

  override async search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]> {
    const data = await this.postJsonResponse(
      this.endpoint("https://api.tavily.com/search"),
      {
        api_key: this.requireApiKey("tavilyApiKey"),
        query: input.query,
        search_depth: "basic",
        max_results: input.maxResults,
        ...(input.allowedDomains.length > 0 ? { include_domains: input.allowedDomains } : {}),
        ...(input.blockedDomains.length > 0 ? { exclude_domains: input.blockedDomains } : {}),
        ...(input.freshness === "any" ? {} : { days: freshnessDays(input.freshness) }),
      },
      input.timeoutMs ?? this.options.configuration.search.requestTimeoutMs,
      signal,
    );
    return projectSearchResults(readResultArray(data, ["results"]));
  }
}

class BraveSearchProvider extends HttpSearchProvider {
  readonly id = "brave" as const;

  override async search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]> {
    const query = new URLSearchParams({
      q: input.query,
      count: String(input.maxResults),
      ...(input.freshness === "any" ? {} : { freshness: braveFreshness(input.freshness) }),
    });
    const data = await this.getJson(
      this.endpoint("https://api.search.brave.com/res/v1/web/search"),
      query,
      input.timeoutMs ?? this.options.configuration.search.requestTimeoutMs,
      signal,
      { "X-Subscription-Token": this.requireApiKey("braveApiKey") },
    );
    return projectSearchResults(readResultArray(data, ["web", "results"]));
  }
}

class DuckDuckGoSearchProvider extends HttpSearchProvider {
  readonly id = "duckduckgo" as const;

  override async search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]> {
    const endpoint = this.endpoint("https://html.duckduckgo.com/html/");
    const query = new URLSearchParams({
      q: input.query,
      kl: "wt-wt",
      ...(input.freshness === "any" ? {} : { df: duckDuckGoFreshness(input.freshness) }),
    });
    const response = await this.get(
      endpoint,
      query,
      input.timeoutMs ?? this.options.configuration.search.requestTimeoutMs,
      signal,
    );
    return parseDuckDuckGoResults(decodeWebBody(response.body, response.contentType), response.url);
  }
}

class SearxngSearchProvider extends HttpSearchProvider {
  readonly id = "searxng" as const;

  override async search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchProviderResult[]> {
    const endpoint = this.endpoint("", true);
    const query = new URLSearchParams({
      q: input.query,
      format: "json",
      language: "all",
      safesearch: "0",
      ...(input.allowedDomains.length > 0 ? { domains: input.allowedDomains.join(",") } : {}),
      ...(input.blockedDomains.length > 0 ? { excluded_domains: input.blockedDomains.join(",") } : {}),
      ...(input.freshness === "any" ? {} : { time_range: searxngFreshness(input.freshness) }),
    });
    const data = await this.getJson(
      endpoint,
      query,
      input.timeoutMs ?? this.options.configuration.search.requestTimeoutMs,
      signal,
    );
    return projectSearchResults(readResultArray(data, ["results"]));
  }
}

export function parseDuckDuckGoResults(source: string, baseUrl: string): AgentWebSearchProviderResult[] {
  const document = parseHTML(source).document;
  const results: AgentWebSearchProviderResult[] = [];
  for (const result of Array.from(document.querySelectorAll(".result"))) {
    const titleElement = result.querySelector("a.result__a, h2 a");
    const href = titleElement?.getAttribute("href")?.trim();
    const url = resolveDuckDuckGoResultUrl(href, baseUrl);
    const title = compactText(titleElement?.textContent ?? "", 512);
    if (!url || !title) continue;
    results.push({
      title,
      url,
      summary: compactText(result.querySelector(".result__snippet")?.textContent ?? "", 4_000),
    });
  }
  return results;
}

function resolveDuckDuckGoResultUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, baseUrl);
    if (isDuckDuckGoHost(parsed.hostname) && parsed.pathname.startsWith("/l/")) {
      const destination = parsed.searchParams.get("uddg");
      if (!destination) return undefined;
      return normalizeResultUrl(destination);
    }
    if (isDuckDuckGoHost(parsed.hostname)) return undefined;
    return normalizeResultUrl(parsed.toString());
  } catch {
    return undefined;
  }
}

function isDuckDuckGoHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "duckduckgo.com" || normalized.endsWith(".duckduckgo.com");
}

function normalizeResultUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      return undefined;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseJsonResponse(url: string, body: Uint8Array, contentType: string): unknown {
  const text = decodeWebBody(body, contentType, 16_000_000).trim();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AgentWebSearchError(
      "invalid_response",
      `Search provider returned invalid JSON: ${url}.`,
      { url, contentType },
      { cause: error },
    );
  }
}

function parseExaMcpSearchResponse(response: {
  readonly url: string;
  readonly body: Uint8Array;
  readonly contentType: string;
}): unknown {
  const source = decodeWebBody(response.body, response.contentType, 16_000_000).trim();
  const envelope = readMcpEnvelope(source, response.url);
  const error = isAgentUnknownRecord(envelope.error) ? envelope.error : undefined;
  if (error) {
    throw new AgentWebSearchError(
      "provider_failed",
      `Exa Remote MCP returned an error: ${readText(error.message) || "unknown error"}.`,
      { provider: "exa", url: response.url, code: error.code },
    );
  }

  const result = isAgentUnknownRecord(envelope.result) ? envelope.result : undefined;
  if (!result || result.isError === true) {
    throw new AgentWebSearchError(
      "provider_failed",
      `Exa Remote MCP did not complete the search: ${readMcpText(result) || "unknown error"}.`,
      { provider: "exa", url: response.url },
    );
  }
  const text = readMcpText(result);
  if (!text) {
    throw new AgentWebSearchError("invalid_response", "Exa Remote MCP returned no search content.", {
      provider: "exa",
      url: response.url,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AgentWebSearchError(
      "invalid_response",
      "Exa Remote MCP returned search content in an unsupported format.",
      { provider: "exa", url: response.url },
      { cause: error },
    );
  }
}

function readMcpEnvelope(source: string, url: string): Record<string, unknown> {
  for (const candidate of readSseDataPayloads(source)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isAgentUnknownRecord(parsed) && (parsed.result !== undefined || parsed.error !== undefined)) return parsed;
    } catch {
      // A streaming notification may not carry the final JSON-RPC envelope.
    }
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (isAgentUnknownRecord(parsed) && (parsed.result !== undefined || parsed.error !== undefined)) return parsed;
  } catch {
    // The error below retains the provider and endpoint without echoing an upstream body.
  }
  throw new AgentWebSearchError("invalid_response", "Exa Remote MCP returned an invalid JSON-RPC response.", {
    provider: "exa",
    url,
  });
}

function readSseDataPayloads(source: string): string[] {
  return source
    .split(/\r?\n\r?\n/gu)
    .map((event) =>
      event
        .split(/\r?\n/gu)
        .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
        .join("\n"),
    )
    .filter(Boolean);
}

function readMcpText(result: Record<string, unknown> | undefined): string {
  if (!result || !Array.isArray(result.content)) return "";
  for (const item of result.content) {
    if (!isAgentUnknownRecord(item) || item.type !== "text") continue;
    const text = readText(item.text);
    if (text) return text;
  }
  return "";
}

function exaDomainFilters(input: AgentWebSearchRequest): Record<string, readonly string[]> {
  return {
    ...(input.allowedDomains.length > 0 ? { includeDomains: input.allowedDomains } : {}),
    ...(input.blockedDomains.length > 0 ? { excludeDomains: input.blockedDomains } : {}),
  };
}

function freshnessStartDate(value: Exclude<AgentWebSearchFreshness, "any">): string {
  const date = new Date(Date.now() - freshnessDays(value) * 86_400_000);
  return date.toISOString();
}

function freshnessDays(value: Exclude<AgentWebSearchFreshness, "any">): number {
  return { day: 1, week: 7, month: 30, year: 365 }[value];
}

function braveFreshness(value: Exclude<AgentWebSearchFreshness, "any">): string {
  return { day: "pd", week: "pw", month: "pm", year: "py" }[value];
}

function normalizeProviderError(provider: AgentWebSearchProvider["id"], error: unknown): Error {
  if (error instanceof AgentWebHttpError && error.code === "http_error" && error.details.status === 429) {
    return new AgentWebSearchError(
      "rate_limited",
      `${provider === "exa" ? "Exa Remote MCP" : provider} is temporarily rate limited. Add an access key or choose another search provider.`,
      { provider, status: 429 },
      { cause: error },
    );
  }
  return error instanceof Error ? error : new AgentWebSearchError("provider_failed", String(error), { provider });
}

function readResultArray(root: unknown, path: readonly string[]): unknown[] {
  let value = root;
  for (const key of path) value = isAgentUnknownRecord(value) ? value[key] : undefined;
  return Array.isArray(value) ? value : [];
}

function projectSearchResult(value: unknown): AgentWebSearchProviderResult | undefined {
  if (!isAgentUnknownRecord(value)) return undefined;
  const url = readText(value.url ?? value.link);
  const title = readText(value.title) || url;
  if (!url || !title) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.username || parsed.password) return undefined;
    parsed.hash = "";
    return {
      title: compactText(title, 512),
      url: parsed.toString(),
      summary: compactText(readSearchSummary(value), 4_000),
      ...(readText(value.published_date ?? value.publishedDate ?? value.date ?? value.page_age)
        ? { publishTime: readText(value.published_date ?? value.publishedDate ?? value.date ?? value.page_age) }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function projectSearchResults(values: readonly unknown[]): AgentWebSearchProviderResult[] {
  return values.flatMap((value) => {
    const result = projectSearchResult(value);
    return result ? [result] : [];
  });
}

export function filterAndCiteSearchResults(
  results: readonly AgentWebSearchProviderResult[],
  input: Pick<AgentWebSearchRequest, "allowedDomains" | "blockedDomains" | "maxResults">,
): Array<AgentWebSearchProviderResult & { citationId: string }> {
  const seen = new Set<string>();
  return results
    .flatMap((result) => {
      let url: URL;
      try {
        url = new URL(result.url);
      } catch {
        return [];
      }
      const hostname = url.hostname.toLowerCase();
      if (!domainAllowed(hostname, input.allowedDomains) || domainBlocked(hostname, input.blockedDomains)) return [];
      const canonical = url.toString();
      if (seen.has(canonical)) return [];
      seen.add(canonical);
      return [{ ...result, url: canonical, citationId: `citation_${sha256Hex(canonical).slice(0, 16)}` }];
    })
    .slice(0, input.maxResults);
}

export function domainAllowed(hostname: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.length === 0 || allowedDomains.some((domain) => matchesDomain(hostname, domain));
}

export function domainBlocked(hostname: string, blockedDomains: readonly string[]): boolean {
  return blockedDomains.some((domain) => matchesDomain(hostname, domain));
}

function matchesDomain(hostname: string, candidate: string): boolean {
  const normalized = candidate
    .trim()
    .toLowerCase()
    .replace(/^\*\./u, "")
    .replace(/^\.+|\.+$/gu, "");
  return normalized.length > 0 && (hostname === normalized || hostname.endsWith(`.${normalized}`));
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readSearchSummary(value: Record<string, unknown>): string {
  const direct = readText(value.content ?? value.description ?? value.snippet ?? value.text);
  if (direct) return direct;
  if (!Array.isArray(value.highlights)) return "";
  return value.highlights
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .trim();
}

function compactText(value: string, maxChars: number): string {
  return Array.from(value.replaceAll(/\s+/gu, " ").trim()).slice(0, maxChars).join("");
}

function duckDuckGoFreshness(value: Exclude<AgentWebSearchFreshness, "any">): string {
  return { day: "d", week: "w", month: "m", year: "y" }[value];
}

function searxngFreshness(value: Exclude<AgentWebSearchFreshness, "any">): string {
  return { day: "day", week: "week", month: "month", year: "year" }[value];
}
