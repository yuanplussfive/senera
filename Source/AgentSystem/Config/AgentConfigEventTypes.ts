import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentModelProviderListItem } from "../Types/AgentConfigTypes.js";
import type { AgentPluginConfigSnapshotItem } from "../Types/PluginConfigTypes.js";
import type { AgentUserProfile } from "../Session/AgentUserProfile.js";
import type {
  AgentPresetOperationResult,
  AgentPresetSnapshot,
} from "../Presets/AgentPresetTypes.js";
import type {
  AgentConfigDiagnostic,
  AgentConfigSnapshot,
  AgentConfigSnapshotSource,
} from "./AgentConfigService.js";
import type { AgentProviderModelSnapshot } from "./AgentProviderModelDiscovery.js";

export type AgentPluginConfigOperationKind = "list" | "update" | "set_enabled" | "config_update";

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
        source?: AgentConfigSnapshotSource;
        revision?: number;
        databasePath?: string;
        diagnostics?: AgentConfigDiagnostic[];
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
      kind: typeof AgentEventKinds.ProviderModelsSnapshot;
      context: AgentEventContext;
      data: AgentProviderModelSnapshot;
    }
  | {
      kind: typeof AgentEventKinds.ProviderModelsFailed;
      context: AgentEventContext;
      data: {
        providerId: string;
        message: string;
        details?: unknown;
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
    }
  | {
      kind: typeof AgentEventKinds.ConfigSnapshot;
      context: AgentEventContext;
      data: AgentConfigSnapshot & {
        operation?: AgentPluginConfigOperationResult;
      };
    }
  | {
      kind: typeof AgentEventKinds.PresetSnapshot;
      context: AgentEventContext;
      data: AgentPresetSnapshot;
    }
  | {
      kind: typeof AgentEventKinds.PresetFailed;
      context: AgentEventContext;
      data: {
        message: string;
        details?: unknown;
        operation?: AgentPresetOperationResult;
      };
    };
