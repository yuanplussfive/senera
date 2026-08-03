import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../Diagnostics/AgentServerEventLogger.js";
import type { AgentUserProfileManager } from "../Session/AgentUserProfile.js";
import type { AgentConfigService } from "../Config/AgentConfigService.js";
import type { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentSandboxRuntimeService } from "../Sandbox/AgentSandboxRuntimeService.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentWebSocketEventPersistenceOptions } from "./AgentWebSocketEventSender.js";
import type { AgentRunEventWriter } from "./AgentRunEventWriter.js";
import type { AgentPiDiagnosticSink } from "../PiShared/AgentPiDiagnosticsTypes.js";
import type { AgentPiTurnContextStore } from "../PiShared/AgentPiTurnContext.js";
import type { AgentMcpManagementService } from "../McpPackages/AgentMcpManagementService.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

export interface AgentWebSocketServerOptions {
  config: AgentSystemConfig;
  workspaceRoot?: string;
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
  eventPersistence?: AgentWebSocketEventPersistenceOptions;
  eventWriter: AgentRunEventWriter;
  mcpManagement?: AgentMcpManagementService;
  piTurnContexts: AgentPiTurnContextStore;
  uploadStore?: AgentUploadStore;
}

export interface AgentWebSocketRequestContext {
  config: AgentSystemConfig;
  configSnapshot: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  providerModelDiscovery: AgentProviderModelDiscovery;
  presetManagerFactory: () => AgentPresetManager;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  sandboxRuntimeService: AgentSandboxRuntimeService;
  executionResources?: AgentExecutionResourceBroker;
  workspaceRoot: string;
  mcpManagement?: AgentMcpManagementService;
}

export type AgentWebSocketEventSender = (event: AgentDomainEvent) => void | Promise<void>;
