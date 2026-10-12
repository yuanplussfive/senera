import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentModelProviderListItem } from "../Types/AgentConfigTypes.js";
import type { AgentUserProfile } from "../Session/AgentUserProfile.js";
import type { AgentConfigDiagnostic, AgentConfigSnapshot, AgentConfigSnapshotSource } from "./AgentConfigService.js";
import type { AgentProviderModelSnapshot } from "./AgentProviderModelDiscovery.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentModelsDevCatalogStatus } from "../ModelEndpoints/AgentModelsDevCatalog.js";

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

export interface AgentWorkspaceSnapshotData {
  workspaceId: string;
  workspaces: readonly import("../WorkspaceResources/AgentWorkspaceCatalog.js").AgentWorkspaceDescriptor[];
  capabilities: { browseDirectories: boolean };
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
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
        modelsDev: AgentModelsDevCatalogStatus;
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
      kind: typeof AgentEventKinds.WorkspaceSnapshot;
      context: AgentEventContext;
      data: AgentWorkspaceSnapshotData;
    }
  | {
      kind: typeof AgentEventKinds.WorkspaceSwitchStarted;
      context: AgentEventContext;
      data: {
        requestId: string;
        workspaceRoot: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.WorkspaceSwitched;
      context: AgentEventContext;
      data: AgentWorkspaceSnapshotData & { requestId: string };
    }
  | {
      kind: typeof AgentEventKinds.WorkspaceSwitchFailed;
      context: AgentEventContext;
      data: {
        requestId: string;
        workspaceRoot: string;
        message: string;
        localizedMessage?: AgentLocalizedMessage;
        details?: unknown;
      };
    };
