import type { resolveModelProviderConfig } from "../AgentDefaults.js";
import type { AgentModelUsage } from "./AgentModelUsage.js";
import type { AgentPiSessionLifecycleMetadata } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentToolAvailabilitySnapshot } from "../ToolRuntime/AgentToolAvailabilitySnapshot.js";
import type { AgentSessionLifecycleMetadata } from "../Session/AgentSessionLifecycleMetadata.js";
import type { AgentSessionMessageQueueMode } from "../Session/AgentSessionMessageQueueMode.js";
import type { AgentChannelEvent, AgentChannelKind } from "../Channels/AgentChannelTypes.js";
import type { AgentSessionRecoveryMode } from "../Session/AgentSessionRunRecovery.js";
import type { AgentExplicitActivationSet } from "../Activation/AgentActivationTypes.js";

export type { AgentModelUsage } from "./AgentModelUsage.js";

export interface AgentModelProviderMetadata {
  id: string;
  /** Stable configured supplier identity, distinct from the model configuration id. */
  providerId?: string;
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
export type AgentModelSelectionSource = "request" | "session_preference" | "default" | "channel" | "agent";

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
  platform: AgentChannelKind;
  chatType?: "direct" | "group" | "channel" | "thread";
  chatId?: string;
  /** Native conversation name, distinct from the sender's display name. */
  chatName?: string;
  userId?: string;
  messageId?: string;
  /** Opaque host-owned conversation space identity used for cache affinity. */
  spaceId?: string;
}

export interface AgentConversationEntryMetadata {
  /** Trusted host provenance. Content remains data and never grants permissions. */
  hostInput?: {
    kind: "agent_message" | "agent_completion" | "job_completion" | "schedule";
    sourceId: string;
    deliveryId: string;
    /** False leaves the notice durable for the next ordinary turn. */
    wake?: boolean;
  };
  /**
   * Durable user turn answered by an assistant entry. Recovery attempts have
   * their own run request id, so this relation must not be inferred from it.
   */
  sourceRequestId?: string;
  run?: AgentRunMetadata;
  channel?: AgentChannelMetadata;
  /** Native platform action that triggered this entry; it is not user-authored text. */
  channelEvent?: AgentChannelEvent;
  scheduledTask?: {
    taskId: string;
    runId: string;
  };
  proactive?: {
    sourceId: string;
    deliveryId: string;
  };
  queue?: {
    parentRequestId: string;
    mode: AgentSessionMessageQueueMode;
    status?: import("../Core/AgentSessionInputContract.js").AgentSessionInputState;
    message?: string;
  };
  recovery?: {
    mode: AgentSessionRecoveryMode;
    sourceRequestId: string;
  };
  activation?: AgentExplicitActivationSet;
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
  /** Last admitted execution policy, inherited by host wakeups without escalation. */
  executionPolicy?: {
    approvalMode: import("../Safety/AgentExecutionApprovalMode.js").AgentExecutionApprovalMode;
    allowedToolNames?: readonly string[];
    systemPromptLayer?: import("../Orchestration/AgentRunDispatchPort.js").AgentSystemPromptLayer;
    pinnedSkills?: readonly import("../Skills/AgentSkillActivation.js").AgentPinnedSkillReference[];
    thinkingLevel?: import("@earendil-works/pi-ai").ModelThinkingLevel;
    inheritProjectContext?: boolean;
    interaction?: import("../Interaction/AgentInteractionContext.js").AgentInteractionContext;
  };
  /** Persistent workspace Agent owning this conversation, independent of delegated child roles. */
  agentId?: string;
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
    providerId: config.ProviderId,
    kind: config.Kind,
    endpoint: config.Endpoint,
    baseUrl: config.BaseUrl,
    model: config.Model,
  };
}
