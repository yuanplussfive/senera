import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentModelProviderListItem } from "../Types/AgentConfigTypes.js";
import type { AgentUserProfile } from "../Session/AgentUserProfile.js";
import type { AgentPresetOperationResult, AgentPresetSnapshot } from "../Presets/AgentPresetTypes.js";
import type { AgentConfigDiagnostic, AgentConfigSnapshot, AgentConfigSnapshotSource } from "./AgentConfigService.js";
import type { AgentProviderModelSnapshot } from "./AgentProviderModelDiscovery.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";

export type AgentSystemConfigOperationKind =
  | "config_update"
  | "provider.endpoint.upsert"
  | "provider.endpoint.delete"
  | "provider.endpoint.rename"
  | "provider.model.upsert"
  | "provider.model.delete"
  | "provider.model.bulkImport"
  | "provider.defaultModel.set";

export interface AgentSystemConfigOperationResult {
  commandId: string;
  kind: AgentSystemConfigOperationKind;
}

export type AgentConfigDomainEvent =
  | {
      kind: typeof AgentEventKinds.ConfigReloaded;
      context: AgentEventContext;
      data: {
        configPath: string;
        source?: AgentConfigSnapshotSource;
        revision?: number;
        diagnostics?: AgentConfigDiagnostic[];
      };
    }
  | {
      kind: typeof AgentEventKinds.ConfigFailed;
      context: AgentEventContext;
      data: {
        configPath: string;
        message: string;
        localizedMessage?: AgentLocalizedMessage;
        details?: unknown;
        operation?: AgentSystemConfigOperationResult;
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
        localizedMessage?: AgentLocalizedMessage;
        details?: unknown;
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
        operation?: AgentSystemConfigOperationResult;
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
        localizedMessage?: AgentLocalizedMessage;
        details?: unknown;
        operation?: AgentPresetOperationResult;
      };
    };
