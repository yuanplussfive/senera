import type {
  AgentChannelAdapter,
  AgentChannelConfig,
  AgentChannelKind,
  AgentChannelSource,
} from "./AgentChannelTypes.js";
import type { AgentOneBot11MessageStore } from "./Adapters/AgentOneBot11MessageStore.js";
import { AgentTelegramChannelAdapter } from "./Adapters/AgentTelegramChannelAdapter.js";
import { AgentDiscordChannelAdapter } from "./Adapters/AgentDiscordChannelAdapter.js";
import { AgentQqChannelAdapter } from "./Adapters/AgentQqChannelAdapter.js";
import { AgentOneBot11ChannelAdapter } from "./Adapters/AgentOneBot11ChannelAdapter.js";
import { AgentExternalOneBot11ChannelAdapter } from "./Adapters/AgentExternalOneBot11ChannelAdapter.js";

export interface AgentChannelAdapterFactory {
  readonly kind: AgentChannelKind;
  readonly create: (config: AgentChannelConfig) => AgentChannelAdapter;
  /** Local protocol history participates in the host session lifecycle, even while disconnected. */
  readonly clearHistory?: (source: AgentChannelSource) => void | Promise<void>;
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

  async clearHistory(source: AgentChannelSource): Promise<void> {
    await this.factories.get(source.platform)?.clearHistory?.(source);
  }
}

export interface AgentChannelAdapterRegistryOptions {
  readonly agentDirectory?: import("../Profile/AgentDirectory.js").AgentDirectory;
  readonly factories?: readonly AgentChannelAdapterFactory[];
  /** Per-workspace state root used by the local Virtual OneBot gateway. */
  readonly oneBot11RuntimeDirectory?: string;
  /** Same-origin host path used by browser clients, including container deployments. */
  readonly oneBot11MediaBasePath?: string;
  /** Workspace user identity represented by the local virtual client. */
  readonly oneBot11OperatorDisplayName?: () => string;
  readonly oneBot11MessageStore?: AgentOneBot11MessageStore;
  readonly uploadStore?: import("../Uploads/AgentUploadStore.js").AgentUploadStore;
  readonly participationStore?: import("./AgentChannelParticipationStore.js").AgentChannelParticipationStore;
}

export function createDefaultAgentChannelRegistry(
  options?: AgentChannelAdapterRegistryOptions,
): AgentChannelAdapterRegistry {
  const registry = new AgentChannelAdapterRegistry();
  for (const factory of options?.factories ?? defaultFactories(options)) {
    registry.register(factory);
  }
  return registry;
}

function defaultFactories(options?: AgentChannelAdapterRegistryOptions): AgentChannelAdapterFactory[] {
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
          groupSessionsPerUser: config.groupSessionsPerUser,
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
    {
      kind: "onebot11",
      clearHistory: options?.oneBot11MessageStore
        ? (source) => {
            if (!source.authority) options.oneBot11MessageStore!.clear(source);
          }
        : undefined,
      create: () => {
        if (!options?.oneBot11RuntimeDirectory || !options.oneBot11MediaBasePath) {
          throw new Error("OneBot 11 requires workspace storage and a host media route.");
        }
        if (!options.oneBot11OperatorDisplayName) {
          throw new Error("OneBot 11 requires a workspace user identity for the local operator.");
        }
        return new AgentOneBot11ChannelAdapter({
          directory: requireAgentDirectory(options.agentDirectory),
          resolveOperatorDisplayName: options.oneBot11OperatorDisplayName,
          runtimeDirectory: options.oneBot11RuntimeDirectory,
          messageStore: options.oneBot11MessageStore,
          mediaBasePath: options.oneBot11MediaBasePath,
          uploadStore: options.uploadStore,
        });
      },
    },
    {
      kind: "onebot",
      create: (config) => {
        if (!options?.participationStore || !config.connection)
          throw new Error("OneBot 11 requires a configured external connection and the host channel journal.");
        return new AgentExternalOneBot11ChannelAdapter(config.connection, options.participationStore);
      },
    },
  ];
}

function requireAgentDirectory(directory: AgentChannelAdapterRegistryOptions["agentDirectory"]) {
  if (!directory) throw new Error("The local OneBot gateway requires the workspace Agent directory.");
  return directory;
}

function discordIntents(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
