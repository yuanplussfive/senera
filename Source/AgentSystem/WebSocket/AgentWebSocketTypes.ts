import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../Diagnostics/AgentServerEventLogger.js";
import type { AgentUserProfileManager } from "../Session/AgentUserProfile.js";
import type { AgentConfigService } from "../Config/AgentConfigService.js";
import type { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import type { AgentPluginConfigManager } from "../Plugin/AgentPluginConfigManager.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentSandboxRuntimeService } from "../Sandbox/AgentSandboxRuntimeService.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentWebSocketEventPersistenceOptions } from "./AgentWebSocketEventSender.js";
import type { AgentRunEventWriter } from "./AgentRunEventWriter.js";

export interface AgentWebSocketServerOptions {
  config: AgentSystemConfig;
  workspaceRoot?: string;
  staticFrontendRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  pluginConfigManager?: AgentPluginConfigManager;
  logger?: AgentLogger;
  eventLogger?: AgentServerEventLogger;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  sandboxRuntimeService?: AgentSandboxRuntimeService;
  executionResources?: AgentExecutionResourceBroker;
  eventPersistence?: AgentWebSocketEventPersistenceOptions;
  eventWriter: AgentRunEventWriter;
}

export interface AgentWebSocketRequestContext {
  config: AgentSystemConfig;
  configSnapshot: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  pluginConfigManager: AgentPluginConfigManager;
  providerModelDiscovery: AgentProviderModelDiscovery;
  presetManagerFactory: () => AgentPresetManager;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  sandboxRuntimeService: AgentSandboxRuntimeService;
  executionResources?: AgentExecutionResourceBroker;
  workspaceRoot: string;
}

export type AgentWebSocketEventSender = (event: AgentDomainEvent) => void | Promise<void>;
