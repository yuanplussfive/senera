import type { AgentChannelAdapter, AgentChannelConfig, AgentChannelKind } from "./AgentChannelTypes.js";
import { AgentTelegramChannelAdapter } from "./Adapters/AgentTelegramChannelAdapter.js";
import { AgentDiscordChannelAdapter } from "./Adapters/AgentDiscordChannelAdapter.js";
import { AgentQqChannelAdapter } from "./Adapters/AgentQqChannelAdapter.js";

export interface AgentChannelAdapterFactory {
  readonly kind: AgentChannelKind;
  readonly create: (config: AgentChannelConfig) => AgentChannelAdapter;
}

export const AgentChannelAdapterRegistryDefaults = Object.freeze({
  normalDurationMs: 1_000,
});

export class AgentChannelAdapterRegistry {
  private readonly factories = new Map<AgentChannelKind, AgentChannelAdapterFactory>();

  register(factory: AgentChannelAdapterFactory): void {
    if (this.factories.has(factory.kind)) {
      throw new Error(`Channel adapter is already registered: ${factory.kind}`);
    }
    this.factories.set(factory.kind, factory);
  }

  has(kind: AgentChannelKind): boolean {
    return this.factories.has(kind);
  }

  create(kind: AgentChannelKind, config: AgentChannelConfig): AgentChannelAdapter {
    const factory = this.factories.get(kind);
    if (!factory) throw new Error(`No channel adapter registered for: ${kind}`);
    const adapter = factory.create(config);
    if (typeof adapter.getConnectionState !== "function") {
      throw new Error(`Channel adapter ${kind} violates the lifecycle contract: getConnectionState() is required.`);
    }
    return adapter;
  }

  kinds(): AgentChannelKind[] {
    return [...this.factories.keys()];
  }
}

export interface AgentChannelAdapterRegistryOptions {
  readonly factories?: readonly AgentChannelAdapterFactory[];
}

export function createDefaultAgentChannelRegistry(
  options?: AgentChannelAdapterRegistryOptions,
): AgentChannelAdapterRegistry {
  const registry = new AgentChannelAdapterRegistry();
  for (const factory of options?.factories ?? defaultFactories()) {
    registry.register(factory);
  }
  return registry;
}

function defaultFactories(): AgentChannelAdapterFactory[] {
  return [
    {
      kind: "telegram",
      create: (config) =>
        new AgentTelegramChannelAdapter({
          token: config.token ?? "",
          mode: config.mode === "webhook" ? "webhook" : "long_polling",
          webhookSecret: config.webhookSecret,
          webhookUrl: config.webhookUrl,
        }),
    },
    {
      kind: "discord",
      create: (config) =>
        new AgentDiscordChannelAdapter({
          token: config.token ?? "",
          intents: discordIntents(config.unknown?.intents),
        }),
    },
    {
      kind: "qq",
      create: (config) =>
        new AgentQqChannelAdapter({
          appId: config.appId ?? "",
          appSecret: config.appSecret ?? "",
          mode: config.mode === "webhook" ? "webhook" : "websocket",
          webhookSecret: config.webhookSecret,
          maxMessageLength: config.maxMessageLength,
          markdownSupport: config.markdownSupport,
          dedupWindowMs: config.dedupWindowMs,
          dedupMaxSize: config.dedupMaxSize,
          intents: integerValue(config.intents),
          maxMediaBytes: integerValue(config.maxMediaBytes),
          inlineMediaLimitBytes: integerValue(config.inlineMediaLimitBytes),
          mediaUploadTimeoutMs: integerValue(config.mediaUploadTimeoutMs),
          chunkUploadTimeoutMs: integerValue(config.chunkUploadTimeoutMs),
          uploadConcurrency: integerValue(config.uploadConcurrency),
          mediaCacheTtlMs: integerValue(config.mediaCacheTtlMs),
          typingDebounceMs: integerValue(config.typingDebounceMs),
          ackTimeoutMs: integerValue(config.ackTimeoutMs),
          maxReconnectAttempts: integerValue(config.maxReconnectAttempts),
          quickDisconnectThresholdMs: integerValue(config.quickDisconnectThresholdMs),
          maxQuickDisconnects: integerValue(config.maxQuickDisconnects),
          quickDisconnectCooldownMs: integerValue(config.quickDisconnectCooldownMs),
          stt: config.stt,
        }),
    },
  ];
}

function discordIntents(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
