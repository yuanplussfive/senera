import type { AgentWebToolsConfiguration } from "./AgentWebConfiguration.js";
import type { AgentWebRenderStrategy } from "./AgentWebDynamicPolicy.js";
import type { AgentWebRenderDiagnostics } from "./AgentWebRenderTypes.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

export const AgentWebSearchFreshnessValues = ["any", "day", "week", "month", "year"] as const;
export type AgentWebSearchFreshness = (typeof AgentWebSearchFreshnessValues)[number];

export const AgentWebContentModeValues = ["auto", "article", "page", "text"] as const;
export type AgentWebContentMode = (typeof AgentWebContentModeValues)[number];

export interface AgentWebSearchRequest {
  readonly query: string;
  readonly allowedDomains: readonly string[];
  readonly blockedDomains: readonly string[];
  readonly freshness: AgentWebSearchFreshness;
  readonly maxResults: number;
  /** Optional host-bounded deadline for this request. */
  readonly timeoutMs?: number;
}

export interface AgentWebSearchProviderResult {
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly publishTime?: string;
}

export interface AgentWebSearchResult extends AgentWebSearchProviderResult {
  readonly citationId: string;
}

export interface AgentWebSearchOutput {
  readonly query: string;
  readonly results: readonly AgentWebSearchResult[];
}

export interface AgentWebFetchRequest {
  readonly url: string;
  readonly extractPrompt?: string;
  readonly maxBytes?: number;
  readonly contentMode: AgentWebContentMode;
  readonly renderStrategy?: AgentWebRenderStrategy;
  /** Optional host-bounded deadline for this request. */
  readonly timeoutMs?: number;
}

export interface AgentWebFetchLink {
  readonly title: string;
  readonly url: string;
}

/** Transfer facts retained with a fetched page so partial source material is never mistaken for complete content. */
export interface AgentWebFetchTransfer {
  /** The byte budget selected for this individual request after applying the host maximum. */
  readonly maxBytes: number;
  /** Bytes retained locally and passed to the content extractor. */
  readonly receivedBytes: number;
  /** The server's Content-Length when it supplied a valid value. */
  readonly declaredContentLength?: number;
  /** True when the response body continued beyond the retained byte budget. */
  readonly truncated: boolean;
}

export interface AgentWebFetchOutput {
  readonly title: string;
  readonly finalUrl: string;
  readonly markdownSummary: string;
  /** Extracted Markdown is retained in the tool artifact and omitted from the normal observation. */
  readonly content: string;
  readonly links: readonly AgentWebFetchLink[];
  readonly citationId: string;
  readonly transfer: AgentWebFetchTransfer;
  readonly render: AgentWebRenderDiagnostics;
}

export interface AgentWebRuntimeOptions {
  readonly model?: string;
  /** Resolves a configured Senera model entry to the model identifier expected by the selected provider. */
  readonly resolveModel?: (configuredModelId: string) => string;
  readonly fetchImpl?: typeof fetch;
  readonly resolveHostAddresses?: (hostname: string) => Promise<readonly string[]>;
  readonly now?: () => number;
  readonly browserRuntime?: import("../Browser/AgentBrowserRuntime.js").AgentBrowserRuntime;
}

export interface AgentWebRuntime {
  readonly configuration: AgentWebToolsConfiguration;
  search(input: AgentWebSearchRequest, signal?: AbortSignal): Promise<AgentWebSearchOutput>;
  fetch(
    input: AgentWebFetchRequest,
    signal?: AbortSignal,
    context?: AgentHostToolContext,
  ): Promise<AgentWebFetchOutput>;
}
