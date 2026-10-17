import { z } from "zod";
import { AgentWebContentModeValues } from "./AgentWebTypes.js";
import { AgentWebRenderStrategyValues } from "./AgentWebDynamicPolicy.js";
import { createAgentWebToolsConfigurationUi } from "./AgentWebConfigurationUi.js";

export const AgentWebSearchProviderValues = ["exa", "codex", "tavily", "brave", "searxng"] as const;
export type AgentWebSearchProvider = (typeof AgentWebSearchProviderValues)[number];

export const AgentWebToolsConfigurationLimits = {
  apiKeyMaxLength: 4_096,
  userAgentLength: { min: 1, max: 256 },
  requestTimeoutMs: { min: 1_000, max: 15 * 60 * 1_000 },
  searchCacheMaxEntries: { min: 0, max: 4_096 },
  search: {
    modelNameLength: { min: 1, max: 256 },
    maxResults: { min: 1, max: 100 },
    responseMaxBytes: { min: 1_024, max: 64 * 1024 * 1024 },
    cacheTtlSeconds: { min: 0, max: 86_400 },
  },
  fetch: {
    responseMaxBytes: { min: 1_024, max: 256 * 1024 * 1024 },
    markdownMaxChars: { min: 1_024, max: 10_000_000 },
    maxRedirects: { min: 0, max: 20 },
    maxUrlLength: { min: 256, max: 32_768 },
    maxLinks: { min: 0, max: 2_000 },
    maxExtractBlocks: { min: 1, max: 256 },
  },
  detection: {
    minimumUsefulTextChars: { min: 1, max: 1_000_000 },
    minimumContentDensity: { min: 0, max: 1 },
    minimumContentBlocks: { min: 0, max: 10_000 },
    maximumScriptShare: { min: 0, max: 1 },
    score: { min: 0, max: 1 },
    weight: { min: 0, max: 1 },
  },
  browserRender: {
    minimumRemainingTimeoutMs: { min: 250, max: 60_000 },
    settleTimeoutMs: { min: 250, max: 300_000 },
    settlePollMs: { min: 50, max: 10_000 },
    stableSamples: { min: 1, max: 20 },
    maxHtmlChars: { min: 1_024, max: 10_000_000 },
    minimumContentGainChars: { min: 1, max: 10_000_000 },
    minimumContentGainRatio: { min: 0, max: 1_000 },
  },
} as const;

export const DefaultAgentWebToolsConfiguration = {
  search: {
    provider: "exa" as const,
    endpoint: "",
    exaApiKey: "",
    codexEndpoint: "",
    codexModel: "",
    codexApiKey: "",
    tavilyApiKey: "",
    braveApiKey: "",
    defaultMaxResults: 8,
    maxMaxResults: 20,
    responseMaxBytes: 2_000_000,
    cacheTtlSeconds: 60,
    cacheMaxEntries: 256,
    requestTimeoutMs: 180_000,
    maxOperationTimeoutMs: 900_000,
    allowPrivateNetworks: false,
    allowSyntheticProxyAddresses: true,
  },
  fetch: {
    responseMaxBytes: 5_000_000,
    markdownMaxChars: 120_000,
    maxRedirects: 5,
    maxUrlLength: 4_096,
    maxLinks: 128,
    maxExtractBlocks: 12,
    defaultContentMode: "auto" as const,
    render: {
      strategy: "auto" as const,
      detection: {
        minimumUsefulTextChars: 240,
        minimumContentDensity: 0.04,
        minimumContentBlocks: 2,
        maximumScriptShare: 0.5,
        dynamicScoreThreshold: 0.58,
        reasonScoreThreshold: 0.35,
        weights: {
          textDeficit: 0.34,
          densityDeficit: 0.26,
          scriptPressure: 0.24,
          structureDeficit: 0.16,
        },
      },
      browser: {
        minimumRemainingTimeoutMs: 1_000,
        settleTimeoutMs: 8_000,
        settlePollMs: 250,
        stableSamples: 2,
        maxHtmlChars: 96_000,
        minimumContentGainChars: 80,
        minimumContentGainRatio: 0.15,
      },
    },
    requestTimeoutMs: 180_000,
    maxOperationTimeoutMs: 900_000,
    allowPrivateNetworks: false,
    allowSyntheticProxyAddresses: true,
    userAgent: "Senera-WebTools/1.0",
  },
} as const;

export const AgentWebToolsConfigurationSchema = z
  .object({
    search: z
      .object({
        provider: z.enum(AgentWebSearchProviderValues).default(DefaultAgentWebToolsConfiguration.search.provider),
        endpoint: z
          .string()
          .trim()
          .refine((value) => value === "" || isValidUrl(value), "Endpoint must be an absolute URL or empty.")
          .default(DefaultAgentWebToolsConfiguration.search.endpoint),
        exaApiKey: z
          .string()
          .trim()
          .max(AgentWebToolsConfigurationLimits.apiKeyMaxLength)
          .default(DefaultAgentWebToolsConfiguration.search.exaApiKey),
        codexEndpoint: z
          .string()
          .trim()
          .refine(
            (value) => value === "" || isValidUrl(value),
            "Codex Search endpoint must be an absolute URL or empty.",
          )
          .default(DefaultAgentWebToolsConfiguration.search.codexEndpoint),
        codexModel: z
          .string()
          .trim()
          .max(AgentWebToolsConfigurationLimits.search.modelNameLength.max)
          .default(DefaultAgentWebToolsConfiguration.search.codexModel),
        codexApiKey: z
          .string()
          .trim()
          .max(AgentWebToolsConfigurationLimits.apiKeyMaxLength)
          .default(DefaultAgentWebToolsConfiguration.search.codexApiKey),
        tavilyApiKey: z
          .string()
          .trim()
          .max(AgentWebToolsConfigurationLimits.apiKeyMaxLength)
          .default(DefaultAgentWebToolsConfiguration.search.tavilyApiKey),
        braveApiKey: z
          .string()
          .trim()
          .max(AgentWebToolsConfigurationLimits.apiKeyMaxLength)
          .default(DefaultAgentWebToolsConfiguration.search.braveApiKey),
        defaultMaxResults: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.search.maxResults.min)
          .max(AgentWebToolsConfigurationLimits.search.maxResults.max)
          .default(DefaultAgentWebToolsConfiguration.search.defaultMaxResults),
        maxMaxResults: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.search.maxResults.min)
          .max(AgentWebToolsConfigurationLimits.search.maxResults.max)
          .default(DefaultAgentWebToolsConfiguration.search.maxMaxResults),
        responseMaxBytes: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.search.responseMaxBytes.min)
          .max(AgentWebToolsConfigurationLimits.search.responseMaxBytes.max)
          .default(DefaultAgentWebToolsConfiguration.search.responseMaxBytes),
        cacheTtlSeconds: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.search.cacheTtlSeconds.min)
          .max(AgentWebToolsConfigurationLimits.search.cacheTtlSeconds.max)
          .default(DefaultAgentWebToolsConfiguration.search.cacheTtlSeconds),
        cacheMaxEntries: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.searchCacheMaxEntries.min)
          .max(AgentWebToolsConfigurationLimits.searchCacheMaxEntries.max)
          .default(DefaultAgentWebToolsConfiguration.search.cacheMaxEntries),
        requestTimeoutMs: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.requestTimeoutMs.min)
          .max(AgentWebToolsConfigurationLimits.requestTimeoutMs.max)
          .default(DefaultAgentWebToolsConfiguration.search.requestTimeoutMs),
        maxOperationTimeoutMs: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.requestTimeoutMs.min)
          .max(AgentWebToolsConfigurationLimits.requestTimeoutMs.max)
          .default(DefaultAgentWebToolsConfiguration.search.maxOperationTimeoutMs),
        allowPrivateNetworks: z.boolean().default(DefaultAgentWebToolsConfiguration.search.allowPrivateNetworks),
        allowSyntheticProxyAddresses: z
          .boolean()
          .default(DefaultAgentWebToolsConfiguration.search.allowSyntheticProxyAddresses),
      })
      .strict()
      .default(DefaultAgentWebToolsConfiguration.search),
    fetch: z
      .object({
        responseMaxBytes: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.fetch.responseMaxBytes.min)
          .max(AgentWebToolsConfigurationLimits.fetch.responseMaxBytes.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.responseMaxBytes),
        markdownMaxChars: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.fetch.markdownMaxChars.min)
          .max(AgentWebToolsConfigurationLimits.fetch.markdownMaxChars.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.markdownMaxChars),
        maxRedirects: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.fetch.maxRedirects.min)
          .max(AgentWebToolsConfigurationLimits.fetch.maxRedirects.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.maxRedirects),
        maxUrlLength: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.fetch.maxUrlLength.min)
          .max(AgentWebToolsConfigurationLimits.fetch.maxUrlLength.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.maxUrlLength),
        maxLinks: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.fetch.maxLinks.min)
          .max(AgentWebToolsConfigurationLimits.fetch.maxLinks.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.maxLinks),
        maxExtractBlocks: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.fetch.maxExtractBlocks.min)
          .max(AgentWebToolsConfigurationLimits.fetch.maxExtractBlocks.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.maxExtractBlocks),
        defaultContentMode: z
          .enum(AgentWebContentModeValues)
          .default(DefaultAgentWebToolsConfiguration.fetch.defaultContentMode),
        render: z
          .object({
            strategy: z
              .enum(AgentWebRenderStrategyValues)
              .default(DefaultAgentWebToolsConfiguration.fetch.render.strategy),
            detection: z
              .object({
                minimumUsefulTextChars: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.detection.minimumUsefulTextChars.min)
                  .max(AgentWebToolsConfigurationLimits.detection.minimumUsefulTextChars.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.minimumUsefulTextChars),
                minimumContentDensity: z
                  .number()
                  .finite()
                  .min(AgentWebToolsConfigurationLimits.detection.minimumContentDensity.min)
                  .max(AgentWebToolsConfigurationLimits.detection.minimumContentDensity.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.minimumContentDensity),
                minimumContentBlocks: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.detection.minimumContentBlocks.min)
                  .max(AgentWebToolsConfigurationLimits.detection.minimumContentBlocks.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.minimumContentBlocks),
                maximumScriptShare: z
                  .number()
                  .finite()
                  .min(AgentWebToolsConfigurationLimits.detection.maximumScriptShare.min)
                  .max(AgentWebToolsConfigurationLimits.detection.maximumScriptShare.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.maximumScriptShare),
                dynamicScoreThreshold: z
                  .number()
                  .finite()
                  .min(AgentWebToolsConfigurationLimits.detection.score.min)
                  .max(AgentWebToolsConfigurationLimits.detection.score.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.dynamicScoreThreshold),
                reasonScoreThreshold: z
                  .number()
                  .finite()
                  .min(AgentWebToolsConfigurationLimits.detection.score.min)
                  .max(AgentWebToolsConfigurationLimits.detection.score.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.reasonScoreThreshold),
                weights: z
                  .object({
                    textDeficit: z
                      .number()
                      .finite()
                      .min(AgentWebToolsConfigurationLimits.detection.weight.min)
                      .max(AgentWebToolsConfigurationLimits.detection.weight.max)
                      .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.weights.textDeficit),
                    densityDeficit: z
                      .number()
                      .finite()
                      .min(AgentWebToolsConfigurationLimits.detection.weight.min)
                      .max(AgentWebToolsConfigurationLimits.detection.weight.max)
                      .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.weights.densityDeficit),
                    scriptPressure: z
                      .number()
                      .finite()
                      .min(AgentWebToolsConfigurationLimits.detection.weight.min)
                      .max(AgentWebToolsConfigurationLimits.detection.weight.max)
                      .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.weights.scriptPressure),
                    structureDeficit: z
                      .number()
                      .finite()
                      .min(AgentWebToolsConfigurationLimits.detection.weight.min)
                      .max(AgentWebToolsConfigurationLimits.detection.weight.max)
                      .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.weights.structureDeficit),
                  })
                  .strict()
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.detection.weights),
              })
              .strict()
              .default(DefaultAgentWebToolsConfiguration.fetch.render.detection),
            browser: z
              .object({
                minimumRemainingTimeoutMs: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.browserRender.minimumRemainingTimeoutMs.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.minimumRemainingTimeoutMs.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.minimumRemainingTimeoutMs),
                settleTimeoutMs: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.browserRender.settleTimeoutMs.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.settleTimeoutMs.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.settleTimeoutMs),
                settlePollMs: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.browserRender.settlePollMs.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.settlePollMs.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.settlePollMs),
                stableSamples: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.browserRender.stableSamples.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.stableSamples.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.stableSamples),
                maxHtmlChars: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.browserRender.maxHtmlChars.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.maxHtmlChars.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.maxHtmlChars),
                minimumContentGainChars: z
                  .number()
                  .int()
                  .min(AgentWebToolsConfigurationLimits.browserRender.minimumContentGainChars.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.minimumContentGainChars.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.minimumContentGainChars),
                minimumContentGainRatio: z
                  .number()
                  .finite()
                  .min(AgentWebToolsConfigurationLimits.browserRender.minimumContentGainRatio.min)
                  .max(AgentWebToolsConfigurationLimits.browserRender.minimumContentGainRatio.max)
                  .default(DefaultAgentWebToolsConfiguration.fetch.render.browser.minimumContentGainRatio),
              })
              .strict()
              .default(DefaultAgentWebToolsConfiguration.fetch.render.browser),
          })
          .strict()
          .default(DefaultAgentWebToolsConfiguration.fetch.render),
        requestTimeoutMs: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.requestTimeoutMs.min)
          .max(AgentWebToolsConfigurationLimits.requestTimeoutMs.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.requestTimeoutMs),
        maxOperationTimeoutMs: z
          .number()
          .int()
          .min(AgentWebToolsConfigurationLimits.requestTimeoutMs.min)
          .max(AgentWebToolsConfigurationLimits.requestTimeoutMs.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.maxOperationTimeoutMs),
        allowPrivateNetworks: z.boolean().default(DefaultAgentWebToolsConfiguration.fetch.allowPrivateNetworks),
        allowSyntheticProxyAddresses: z
          .boolean()
          .default(DefaultAgentWebToolsConfiguration.fetch.allowSyntheticProxyAddresses),
        userAgent: z
          .string()
          .trim()
          .min(AgentWebToolsConfigurationLimits.userAgentLength.min)
          .max(AgentWebToolsConfigurationLimits.userAgentLength.max)
          .default(DefaultAgentWebToolsConfiguration.fetch.userAgent),
      })
      .strict()
      .default(DefaultAgentWebToolsConfiguration.fetch),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.search.defaultMaxResults > configuration.search.maxMaxResults) {
      context.addIssue({
        code: "custom",
        path: ["search", "defaultMaxResults"],
        message: "defaultMaxResults must not exceed maxMaxResults.",
      });
    }
    if (configuration.search.maxOperationTimeoutMs < configuration.search.requestTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["search", "maxOperationTimeoutMs"],
        message: "Maximum operation timeout must not be lower than the default request timeout.",
      });
    }
    if (configuration.fetch.maxOperationTimeoutMs < configuration.fetch.requestTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["fetch", "maxOperationTimeoutMs"],
        message: "Maximum operation timeout must not be lower than the default request timeout.",
      });
    }
    if (configuration.fetch.render.browser.settlePollMs > configuration.fetch.render.browser.settleTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["fetch", "render", "browser", "settlePollMs"],
        message: "Browser settle polling must not exceed the settle timeout.",
      });
    }
    const weights = configuration.fetch.render.detection.weights;
    if (weights.textDeficit + weights.densityDeficit + weights.scriptPressure + weights.structureDeficit <= 0) {
      context.addIssue({
        code: "custom",
        path: ["fetch", "render", "detection", "weights"],
        message: "At least one dynamic-page detection weight must be greater than zero.",
      });
    }
  });

export type AgentWebToolsConfiguration = z.output<typeof AgentWebToolsConfigurationSchema>;

export const AgentWebToolsConfigurationUi = createAgentWebToolsConfigurationUi({
  searchProviderValues: AgentWebSearchProviderValues,
  contentModeValues: AgentWebContentModeValues,
  renderStrategyValues: AgentWebRenderStrategyValues,
  limits: AgentWebToolsConfigurationLimits,
});

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
