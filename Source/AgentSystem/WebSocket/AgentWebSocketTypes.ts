import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../Diagnostics/AgentServerEventLogger.js";
import type { AgentUserProfileManager } from "../Session/AgentUserProfile.js";
import type { AgentConfigService } from "../Config/AgentConfigService.js";
import type { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentSandboxRuntimeService } from "../Sandbox/AgentSandboxRuntimeService.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentWebSocketEventPersistenceOptions } from "./AgentWebSocketEventSender.js";
import type { AgentRunEventWriter } from "./AgentRunEventWriter.js";
import type { AgentPiDiagnosticSink } from "../PiShared/AgentPiDiagnosticsTypes.js";
import type { AgentMcpManagementService } from "../McpPackages/AgentMcpManagementService.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import type { AgentInteractiveTerminalRuntime } from "../ExecutionResources/AgentInteractiveTerminalRuntime.js";
import type { AgentRuntimeUpdateHttpApiOptions } from "../Runtime/AgentRuntimeUpdateHttpApi.js";
import type { AgentChannelKind } from "../Channels/AgentChannelTypes.js";
import type { AgentChannelStatus } from "../Channels/AgentChannelService.js";
import type { AgentModelsDevCatalog } from "../ModelEndpoints/AgentModelsDevCatalog.js";
import type { AgentWorkspaceSnapshotData } from "../Config/AgentConfigEventTypes.js";
import type { AgentServerAccessGuard } from "../Auth/AgentServerAccessGuard.js";
import type { AgentWebSocketTransport } from "./AgentWebSocketTransport.js";
import type { AgentWorkspaceCatalog } from "../WorkspaceResources/AgentWorkspaceCatalog.js";
import type { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";
import type { AgentPluginHost } from "../Plugins/AgentPluginHost.js";

export type AgentPluginCatalogSource = Pick<AgentPluginHost, "list">;

/** Narrow surface the WebSocket layer needs to drive channel connections. */
export interface AgentChannelServiceControl {
  connectChannel(kind: AgentChannelKind): Promise<void>;
  statuses: readonly AgentChannelStatus[];
}

/** Read-only workspace identity reported to connected clients. */
export type AgentWorkspaceInfoSnapshot = AgentWorkspaceSnapshotData;

export type AgentWorkspaceSwitchRequest = (workspaceRoot: string) => Promise<AgentWorkspaceInfoSnapshot>;

export interface AgentWebSocketServerOptions {
  artifactManifestIndex?: AgentArtifactManifestIndexCache;
  onClientCountChanged?: (count: number) => void;
  transport?: AgentWebSocketTransport;
  workspaceId?: string;
  workspaceCatalog?: AgentWorkspaceCatalog;
  openWorkspace?: (id: string) => Promise<void>;
  accessGuard?: AgentServerAccessGuard;
  authenticationRoot?: string;
  config: AgentSystemConfig;
  workspaceRoot?: string;
  /** Deployment-provided safe default for loopback HTTP (for example, a local container port). */
  automaticLoopbackHttp?: boolean;
  staticFrontendRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  logger?: AgentLogger;
  eventLogger?: AgentServerEventLogger;
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  sandboxRuntimeService?: AgentSandboxRuntimeService;
  executionResources?: AgentExecutionResourceBroker;
  interactiveTerminals?: AgentInteractiveTerminalRuntime;
  eventPersistence?: AgentWebSocketEventPersistenceOptions;
  eventWriter: AgentRunEventWriter;
  mcpManagement?: AgentMcpManagementService;
  pluginHost?: AgentPluginCatalogSource;
  uploadStore?: AgentUploadStore;
  resourceResolver?: AgentResourceResolverLike;
  runtimeUpdate?: AgentRuntimeUpdateHttpApiOptions;
  channelWebhookApi?: import("../Channels/AgentChannelWebhookApi.js").AgentChannelWebhookApi;
  selfApi?: import("../SelfService/AgentSelfHttpApi.js").AgentSelfHttpApi;
  channelControl?: AgentChannelServiceControl;
  workspaceInfo?: () => AgentWorkspaceInfoSnapshot;
  workspaceSwitchRequest?: AgentWorkspaceSwitchRequest;
}

export interface AgentWebSocketRequestContext {
  config: AgentSystemConfig;
  configSnapshot: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  providerModelDiscovery: AgentProviderModelDiscovery;
  modelsDevCatalog: AgentModelsDevCatalog;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  sandboxRuntimeService: AgentSandboxRuntimeService;
  executionResources?: AgentExecutionResourceBroker;
  interactiveTerminals?: AgentInteractiveTerminalRuntime;
  workspaceRoot: string;
  mcpManagement?: AgentMcpManagementService;
  pluginHost?: AgentPluginCatalogSource;
  workspaceInfo?: () => AgentWorkspaceInfoSnapshot;
  workspaceSwitchRequest?: AgentWorkspaceSwitchRequest;
}

export type AgentWebSocketEventSender = (event: AgentDomainEvent) => void | Promise<void>;
