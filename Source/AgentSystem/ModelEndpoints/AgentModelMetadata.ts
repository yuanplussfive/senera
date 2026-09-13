import type { resolveModelProviderConfig } from "../AgentDefaults.js";
import type { AgentModelUsage } from "./AgentModelUsage.js";
import type { AgentPiSessionLifecycleMetadata } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentToolAvailabilitySnapshot } from "../ToolRuntime/AgentToolAvailabilitySnapshot.js";
import type { AgentSessionLifecycleMetadata } from "../Session/AgentSessionLifecycleMetadata.js";
import type { AgentSessionMessageQueueMode } from "../Session/AgentSessionMessageQueueMode.js";
import type { AgentChannelFinalizationMetadata } from "../Channels/AgentChannelFinalizationTypes.js";

export type { AgentModelUsage } from "./AgentModelUsage.js";

export interface AgentModelProviderMetadata {
  id: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

/**
 * Authoritative identity of the provider selected for one model turn.  This
 * is deliberately separate from the durable session preference: a preference
 * describes a future selection, while this receipt describes what actually
 * ran and can therefore be projected to the model, UI, and self-service tool.
 */
export type AgentModelSelectionSource = "request" | "session_preference" | "default" | "channel";

export interface AgentEffectiveModelReceipt {
  readonly sessionId: string;
  readonly requestId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpoint: string;
  readonly baseUrl: string;
  readonly source: AgentModelSelectionSource;
  readonly effectiveAt: string;
  readonly logicalCacheScope?: string;
  readonly physicalPiSessionId?: string;
}

export interface AgentRunMetadata {
  modelProvider: AgentModelProviderMetadata;
  usage?: AgentModelUsage;
  receipt?: AgentEffectiveModelReceipt;
}

/** Stable origin metadata shared by persisted sessions and conversation entries. */
export interface AgentChannelMetadata {
  platform: "qq" | "telegram" | "discord";
  chatType?: "direct" | "group" | "channel" | "thread";
  chatId?: string;
  userId?: string;
  messageId?: string;
  /** Opaque host-owned conversation space identity used for cache affinity. */
  spaceId?: string;
}

export interface AgentConversationEntryMetadata {
  run?: AgentRunMetadata;
  channel?: AgentChannelMetadata;
  scheduledTask?: {
    taskId: string;
    runId: string;
  };
  proactive?: {
    sourceId: string;
    deliveryId: string;
  };
  /** Internal wake input for a detached task; adapters render the model reply, not this envelope. */
  backgroundTask?: {
    taskId: string;
    runId: string;
  };
  queue?: {
    parentRequestId: string;
    mode: AgentSessionMessageQueueMode;
  };
}

/** Describes which runtime owns a session. This is persisted with the session. */
export type AgentSessionOwnership =
  | {
      readonly type: "user_conversation";
    }
  | {
      readonly type: "child_run";
      readonly childRunId: string;
      readonly parentSessionId: string;
      readonly parentRequestId: string;
      readonly agentName: string;
    }
  | {
      readonly type: "scheduled_run";
      readonly taskId: string;
    };

export interface AgentSessionMetadata {
  ownership?: AgentSessionOwnership;
  channel?: AgentChannelMetadata;
  lastRun?: AgentRunMetadata;
  /** Durable in-flight receipt, cleared when the turn reaches a terminal state. */
  activeRun?: AgentRunMetadata;
  piSession?: AgentPiSessionLifecycleMetadata;
  /**
   * Durable model preference owned by this conversation. This is deliberately
   * separate from `piSession`: the latter describes the last Pi runtime
   * lifecycle, while this value is the next-turn selection contract.
   */
  sessionModel?: AgentSessionModelPreference;
  toolAvailability?: AgentToolAvailabilitySnapshot;
  lifecycle?: AgentSessionLifecycleMetadata;
  title?: string;
  /** Bounded native channel rewrite examples; kept separate from the transcript. */
  channelFinalization?: AgentChannelFinalizationMetadata;
}

export type AgentSessionModelPreferenceSource = "user" | "agent" | "channel";

export interface AgentSessionModelPreference {
  readonly modelProviderId: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly source: AgentSessionModelPreferenceSource;
}

export type AgentSessionModelPreferenceMutationResult =
  | ({ readonly status: "updated" } & AgentSessionModelPreference & {
        readonly sessionId: string;
        readonly effectiveAt: "next_turn";
      })
  | ({ readonly status: "unchanged" } & AgentSessionModelPreference & {
        readonly sessionId: string;
        readonly effectiveAt: "next_turn";
      })
  | { readonly status: "missing"; readonly sessionId: string };

/** Projects the model that should be shown for a session. A durable
 * next-turn preference wins; Pi/last-run metadata is display-only history. */
export function resolveAgentSessionModelProviderId(metadata: AgentSessionMetadata | undefined): string | undefined {
  return (
    metadata?.sessionModel?.modelProviderId ??
    metadata?.activeRun?.receipt?.providerId ??
    metadata?.lastRun?.receipt?.providerId ??
    metadata?.lastRun?.modelProvider.id ??
    metadata?.piSession?.modelProviderId
  );
}

type ModelProviderConfig = ReturnType<typeof resolveModelProviderConfig>;

export function createModelProviderMetadata(config: ModelProviderConfig): AgentModelProviderMetadata {
  return {
    id: config.Id,
    kind: config.Kind,
    endpoint: config.Endpoint,
    baseUrl: config.BaseUrl,
    model: config.Model,
  };
}
