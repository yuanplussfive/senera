import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../Diagnostics/AgentServerEventLogger.js";
import type { AgentUserProfileManager } from "../Session/AgentUserProfile.js";
import type { AgentConfigService } from "../Config/AgentConfigService.js";
import type { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentPresetSnapshot } from "../Presets/AgentPresetTypes.js";
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
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type { AgentGoalCommandService } from "../Agenda/AgentGoalCommandService.js";
import type { AgentWorldSnapshotProvider } from "../World/AgentWorldTypes.js";
import type { AgentWorldResidentWakeRuntime } from "../World/AgentWorldResidentWakeRuntime.js";
import type { AgentPresetActivationRuntime } from "../Presets/AgentPresetActivationRuntime.js";
import type { AgentChannelKind } from "../Channels/AgentChannelTypes.js";
import type { AgentChannelStatus } from "../Channels/AgentChannelService.js";
import type { AgentModelsDevCatalog } from "../ModelEndpoints/AgentModelsDevCatalog.js";

/** Narrow surface the WebSocket layer needs to drive channel connections. */
export interface AgentChannelServiceControl {
  connectChannel(kind: AgentChannelKind): Promise<void>;
  statuses: readonly AgentChannelStatus[];
}

export interface AgentWebSocketServerOptions {
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
  uploadStore?: AgentUploadStore;
  resourceResolver?: AgentResourceResolverLike;
  runtimeUpdate?: AgentRuntimeUpdateHttpApiOptions;
  channelWebhookApi?: import("../Channels/AgentChannelWebhookApi.js").AgentChannelWebhookApi;
  channelControl?: AgentChannelServiceControl;
  agenda?: AgentAgendaService;
  goalCommands?: AgentGoalCommandService;
  worldRuntime?: AgentWorldSnapshotProvider;
  residentWakeRuntime?: AgentWorldResidentWakeRuntime;
  onWorldWake?: (reason: string) => void | Promise<void>;
  presetActivation?: AgentPresetActivationRuntime;
  onPresetSnapshot?: (snapshot: AgentPresetSnapshot) => void;
}

export interface AgentWebSocketRequestContext {
  config: AgentSystemConfig;
  configSnapshot: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  providerModelDiscovery: AgentProviderModelDiscovery;
  modelsDevCatalog: AgentModelsDevCatalog;
  presetManagerFactory: () => AgentPresetManager;
  onPresetSnapshot?: (snapshot: AgentPresetSnapshot) => void;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  sandboxRuntimeService: AgentSandboxRuntimeService;
  executionResources?: AgentExecutionResourceBroker;
  interactiveTerminals?: AgentInteractiveTerminalRuntime;
  workspaceRoot: string;
  mcpManagement?: AgentMcpManagementService;
  agenda?: AgentAgendaService;
  goalCommands?: AgentGoalCommandService;
  worldRuntime?: AgentWorldSnapshotProvider;
  residentWakeRuntime?: AgentWorldResidentWakeRuntime;
  onWorldWake?: (reason: string) => void | Promise<void>;
}

export type AgentWebSocketEventSender = (event: AgentDomainEvent) => void | Promise<void>;
