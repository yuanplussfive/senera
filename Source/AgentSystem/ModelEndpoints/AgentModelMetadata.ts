import type { resolveModelProviderConfig } from "../AgentDefaults.js";
import type { AgentModelUsage } from "./AgentModelUsage.js";
import type { AgentPiSessionLifecycleMetadata } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentToolAvailabilitySnapshot } from "../ToolRuntime/AgentToolAvailabilitySnapshot.js";
import type { AgentSessionLifecycleMetadata } from "../Session/AgentSessionLifecycleMetadata.js";
import type { AgentSessionMessageQueueMode } from "../Session/AgentSessionMessageQueueMode.js";

export type { AgentModelUsage } from "./AgentModelUsage.js";

export interface AgentModelProviderMetadata {
  id: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

export interface AgentRunMetadata {
  modelProvider: AgentModelProviderMetadata;
  usage?: AgentModelUsage;
}

/** Stable origin metadata shared by persisted sessions and conversation entries. */
export interface AgentChannelMetadata {
  platform: "qq" | "telegram" | "discord";
  chatType?: "direct" | "group" | "channel" | "thread";
  chatId?: string;
  userId?: string;
  messageId?: string;
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
  piSession?: AgentPiSessionLifecycleMetadata;
  toolAvailability?: AgentToolAvailabilitySnapshot;
  lifecycle?: AgentSessionLifecycleMetadata;
  title?: string;
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
