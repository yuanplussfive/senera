import type { AgentDomainEvent } from "../AgentEvent.js";
import type { AgentUserProfileManager } from "../AgentUserProfile.js";
import type { AgentConfigService } from "../Config/AgentConfigService.js";
import type { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import type { AgentPluginConfigManager } from "../Plugin/AgentPluginConfigManager.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export interface AgentWebSocketServerOptions {
  config: AgentSystemConfig;
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  configService?: AgentConfigService;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  pluginConfigManager?: AgentPluginConfigManager;
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
}

export type AgentWebSocketEventSender = (event: AgentDomainEvent) => void;
