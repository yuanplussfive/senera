import { AgentEventKinds } from "./AgentEventCatalog.js";
import type { AgentEventContext } from "./AgentEventBase.js";
import type {
  AgentModelProviderListItem,
  AgentPluginConfigSnapshotItem,
} from "./Types.js";
import type { AgentUserProfile } from "./AgentUserProfile.js";

export type AgentPluginConfigOperationKind = "list" | "update" | "set_enabled";

export interface AgentPluginConfigOperationResult {
  requestId?: string;
  kind: AgentPluginConfigOperationKind;
  pluginName?: string;
}

export type AgentConfigDomainEvent =
  | {
      kind: typeof AgentEventKinds.ConfigReloaded;
      context: AgentEventContext;
      data: {
        configPath: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ConfigFailed;
      context: AgentEventContext;
      data: {
        configPath: string;
        message: string;
        details?: unknown;
        operation?: AgentPluginConfigOperationResult;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelListSnapshot;
      context: AgentEventContext;
      data: {
        models: AgentModelProviderListItem[];
        defaultModelProviderId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.PluginConfigSnapshot;
      context: AgentEventContext;
      data: {
        plugins: AgentPluginConfigSnapshotItem[];
        operation?: AgentPluginConfigOperationResult;
      };
    }
  | {
      kind: typeof AgentEventKinds.ProfileSnapshot;
      context: AgentEventContext;
      data: AgentUserProfile;
    };
