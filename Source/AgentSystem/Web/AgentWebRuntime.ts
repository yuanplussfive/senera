import { sha256Hex } from "../Core/AgentHash.js";
import { decodeWebBody, fetchWebResource } from "./AgentWebHttpClient.js";
import { AgentWebToolsConfigurationLimits, type AgentWebToolsConfiguration } from "./AgentWebConfiguration.js";
import { extractAgentWebContent, isAgentWebHtmlContentType } from "./AgentWebContentExtractor.js";
import { assessAgentWebDocument, type AgentWebRenderDecision } from "./AgentWebDynamicPolicy.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
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
      model: options.model,
      resolveModel: options.resolveModel,
      fetchImpl: options.fetchImpl,
      resolveHostAddresses: options.resolveHostAddresses,
    });
    this.fetchImpl = options.fetchImpl;
    this.resolveHostAddresses = options.resolveHostAddresses;
    this.browserRuntime = options.browserRuntime;
  }

  private readonly fetchImpl?: typeof fetch;
  private readonly resolveHostAddresses?: (hostname: string) => Promise<readonly string[]>;
  private readonly browserRuntime?: AgentWebRuntimeOptions["browserRuntime"];

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

  async fetch(
    input: AgentWebFetchRequest,
    signal?: AbortSignal,
    context?: AgentHostToolContext,
  ): Promise<AgentWebFetchOutput> {
    const requestStartedAt = this.now();
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
    const extracted = extractWebContent(this.configuration, input, source, response.contentType, response.url);
    const assessment = assessAgentWebDocument(source, extracted.markdown, this.configuration.fetch.render.detection);
    const renderStrategy = input.renderStrategy ?? this.configuration.fetch.render.strategy;
    let selectedFinalUrl = response.url;
    let selectedExtracted = extracted;
    let renderDecision: AgentWebRenderDecision = renderStrategy === "http" ? "not_requested" : assessment.decision;
    let usedBrowser = false;
    let browserContentChanged = false;
    let browserOutputTruncated = false;
    let reasons = assessment.reasons;

    const canRenderDocument = isAgentWebHtmlContentType(response.contentType);
    if (renderStrategy === "auto" && !canRenderDocument && assessment.decision === "dynamic_likely") {
      renderDecision = "not_renderable";
      reasons = [...reasons, "响应内容类型不是可浏览器渲染的 HTML 文档"];
    }
    if (
      renderStrategy === "browser" ||
      (renderStrategy === "auto" && canRenderDocument && assessment.decision === "dynamic_likely")
    ) {
      const remainingTimeoutMs = timeoutMs - (this.now() - requestStartedAt);
      if (remainingTimeoutMs < this.configuration.fetch.render.browser.minimumRemainingTimeoutMs) {
        renderDecision = "browser_budget_exhausted";
        reasons = [...reasons, "HTTP 阶段已消耗本次请求的剩余渲染预算"];
        if (renderStrategy === "browser") {
          throw new Error("WebFetch browser rendering has no remaining request budget.");
        }
      } else if (!this.browserRuntime || !context) {
        renderDecision = "browser_unavailable";
        reasons = [...reasons, "受控浏览器运行时不可用"];
        if (renderStrategy === "browser") {
          throw new Error("WebFetch requested browser rendering, but the controlled browser runtime is unavailable.");
        }
      } else {
        const browserContext = renderContext(context);
        let renderFailure: unknown;
        let closeFailure: unknown;
        try {
          const rendered = await this.browserRuntime.execute(
            "render_html",
            {
              url: response.url,
              timeoutMs: Math.min(remainingTimeoutMs, this.browserRuntime.configuration.runtime.maxOperationTimeoutMs),
              settleTimeoutMs: Math.min(remainingTimeoutMs, this.configuration.fetch.render.browser.settleTimeoutMs),
              settlePollMs: this.configuration.fetch.render.browser.settlePollMs,
              stableSamples: this.configuration.fetch.render.browser.stableSamples,
              maxHtmlChars: Math.min(
                this.configuration.fetch.render.browser.maxHtmlChars,
                this.browserRuntime.configuration.runtime.outputMaxChars,
              ),
            },
            browserContext,
          );
          const renderedSource = rendered.result.content ?? "";
          const renderedFinalUrl = rendered.result.page?.url ?? response.url;
          const renderedExtracted = extractWebContent(
            this.configuration,
            input,
            renderedSource,
            "text/html; charset=utf-8",
            renderedFinalUrl,
          );
          browserContentChanged = hasMeaningfulContentChange(
            extracted.markdown,
            renderedExtracted.markdown,
            this.configuration.fetch.render.browser,
          );
          browserOutputTruncated = rendered.result.truncated;
          if (browserContentChanged) {
            selectedFinalUrl = renderedFinalUrl;
            selectedExtracted = renderedExtracted;
            usedBrowser = true;
            renderDecision = "rendered_with_content_change";
          } else {
            renderDecision = "rendered_without_content_change";
            reasons = [...reasons, "浏览器渲染未带来可用正文增量"];
          }
        } catch (error) {
          renderFailure = error;
        } finally {
          try {
            await this.browserRuntime.execute("close", {}, { ...browserContext, signal: undefined });
          } catch (error) {
            closeFailure = error;
          }
        }
        if (renderFailure || closeFailure) {
          renderDecision = "browser_failed";
          if (renderFailure) reasons = [...reasons, `浏览器渲染失败：${errorMessage(renderFailure)}`];
          if (closeFailure) reasons = [...reasons, `浏览器会话关闭失败：${errorMessage(closeFailure)}`];
          if (renderStrategy === "browser") {
            if (renderFailure && closeFailure)
              throw new AggregateError([renderFailure, closeFailure], "Browser rendering and cleanup failed.");
            throw renderFailure ?? closeFailure;
          }
        }
      }
    }

    const content = appendWebFetchNotices(
      selectedExtracted.markdown,
      response.transfer,
      usedBrowser && browserOutputTruncated,
      usedBrowser,
    );
    const markdownSummary = appendWebFetchNotices(
      selectedExtracted.markdownSummary,
      response.transfer,
      usedBrowser && browserOutputTruncated,
      usedBrowser,
    );
    const citationId = `citation_${sha256Hex(`${selectedFinalUrl}\n${content}`).slice(0, 16)}`;
    return {
      title: selectedExtracted.title,
      finalUrl: selectedFinalUrl,
      markdownSummary,
      content,
      links: selectedExtracted.links,
      citationId,
      transfer: response.transfer,
      render: {
        strategy: renderStrategy,
        decision: renderDecision,
        usedBrowser,
        browserContentChanged,
        browserOutputTruncated,
        score: assessment.signals.dynamicScore,
        reasons,
        signals: assessment.signals,
      },
    };
  }
}

function extractWebContent(
  configuration: AgentWebToolsConfiguration,
  input: AgentWebFetchRequest,
  source: string,
  contentType: string,
  finalUrl: string,
) {
  return extractAgentWebContent({
    source,
    contentType,
    finalUrl,
    mode: input.contentMode,
    extractPrompt: input.extractPrompt,
    maxExtractBlocks: configuration.fetch.maxExtractBlocks,
    maxMarkdownChars: configuration.fetch.markdownMaxChars,
    maxLinks: configuration.fetch.maxLinks,
  });
}

function renderContext(context: AgentHostToolContext): AgentHostToolContext {
  const sessionId = context.requestId?.trim() || context.sessionId?.trim();
  if (!sessionId) throw new Error("Web browser rendering requires a host session identity.");
  return {
    ...context,
    sessionId: `${sessionId}:web-fetch-render`,
  };
}

function hasMeaningfulContentChange(
  original: string,
  rendered: string,
  configuration: AgentWebToolsConfiguration["fetch"]["render"]["browser"],
): boolean {
  const originalChars = Array.from(original).length;
  const renderedChars = Array.from(rendered).length;
  const gain = renderedChars - originalChars;
  const ratio = originalChars > 0 ? gain / originalChars : renderedChars > 0 ? 1 : 0;
  return gain >= configuration.minimumContentGainChars && ratio >= configuration.minimumContentGainRatio;
}

function appendTruncationNotice(value: string, transfer: AgentWebFetchOutput["transfer"]): string {
  if (!transfer.truncated) return value;
  const notice = `...[Source response truncated after ${transfer.receivedBytes} bytes; increase maxBytes for more content.]`;
  return value ? `${value}\n\n${notice}` : notice;
}

function appendWebFetchNotices(
  value: string,
  transfer: AgentWebFetchOutput["transfer"],
  browserTruncated: boolean,
  browserSelected: boolean,
): string {
  const withSourceNotice = browserSelected ? value : appendTruncationNotice(value, transfer);
  if (!browserTruncated) return withSourceNotice;
  const notice = "...[Rendered browser output was truncated; increase the configured rendered HTML limit.]";
  return withSourceNotice ? `${withSourceNotice}\n\n${notice}` : notice;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function normalizeSearchRequest(
  input: AgentWebSearchRequest,
  maxMaxResults: number,
  defaultTimeoutMs: number,
  maxOperationTimeoutMs: number,
): AgentWebSearchRequest {
  if (!Number.isSafeInteger(input.maxResults) || input.maxResults <= 0) {
    throw new RangeError("Web maxResults must be a positive safe integer.");
  }
  return {
    query: input.query.trim(),
    allowedDomains: normalizeDomains(input.allowedDomains),
    blockedDomains: normalizeDomains(input.blockedDomains),
    freshness: input.freshness,
    maxResults: Math.min(input.maxResults, maxMaxResults),
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
  if (!Number.isInteger(value) || value < AgentWebToolsConfigurationLimits.requestTimeoutMs.min || value > maximum) {
    throw new Error(
      `Web timeoutMs must be an integer between ${AgentWebToolsConfigurationLimits.requestTimeoutMs.min} and ${maximum}.`,
    );
  }
  return value;
}

function normalizeDomains(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeDomain(value)).filter(Boolean))];
}

function normalizeDomain(value: string): string {
  const source = value.trim().toLowerCase();
  if (!source) return "";
  const wildcard = source.startsWith("*.");
  const candidate = wildcard ? source.slice(2) : source;
  try {
    const parsed = candidate.includes("://") ? new URL(candidate) : new URL(`https://${candidate}`);
    if (
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("domain filter must not include credentials, ports, paths, queries, or fragments");
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/gu, "");
    if (!hostname || hostname.includes("*")) throw new Error("domain filter contains an invalid hostname");
    return hostname;
  } catch (error) {
    throw new RangeError(`Invalid web domain filter "${value}": ${errorMessage(error)}`, { cause: error });
  }
}

function resolveBoundedMaxBytes(value: number | undefined, configured: number): number {
  if (value === undefined) return configured;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Web maxBytes must be a positive safe integer.");
  }
  return Math.min(value, configured);
}

function decodeResponseBody(body: Uint8Array, contentType: string): string {
  return decodeWebBody(body, contentType);
}
