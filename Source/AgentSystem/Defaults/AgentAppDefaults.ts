import type {
  AgentSystemConfig,
  ResolvedAgentArtifactsConfig,
  ResolvedAgentFrontendConfig,
  ResolvedAgentConfigStoreConfig,
  ResolvedAgentPersistenceConfig,
  ResolvedAgentUploadsConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { buildWebSocketUrl, readConfiguredString } from "./AgentDefaultHelpers.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";

export function resolveArtifactsConfig(config: AgentSystemConfig): ResolvedAgentArtifactsConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Artifacts,
    ...config.Artifacts,
  };
}

export function resolveUploadsConfig(config: AgentSystemConfig): ResolvedAgentUploadsConfig {
  const defaults = resolveAgentDefaults(config);
  const uploads = {
    ...defaults.Uploads,
    ...config.Uploads,
  };
  if (uploads.MaxRequestBytes < uploads.MaxFileBytes) {
    throw new AgentLocalizedError("upload.requestLimitBelowFileLimit");
  }
  if (uploads.MaxStoredBytes < uploads.MaxFileBytes) {
    throw new AgentLocalizedError("upload.storageLimitBelowFileLimit");
  }
  return uploads;
}

export function resolveFrontendConfig(config: AgentSystemConfig): ResolvedAgentFrontendConfig {
  const defaults = resolveAgentDefaults(config);
  const configured = config.Frontend;
  const server = resolveServerConfig(config);
  return {
    DevServer: {
      ...defaults.Frontend.DevServer,
      ...configured?.DevServer,
    },
    PreviewServer: {
      ...defaults.Frontend.PreviewServer,
      ...configured?.PreviewServer,
    },
    Client: {
      ...defaults.Frontend.Client,
      ...configured?.Client,
      WebSocketUrl: readConfiguredString(
        configured?.Client?.WebSocketUrl,
        readConfiguredString(defaults.Frontend.Client.WebSocketUrl, buildWebSocketUrl(server)),
      ),
    },
  };
}

export function resolveServerConfig(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Server,
    ...config.Server,
    AccessControl: {
      ...defaults.Server.AccessControl,
      ...config.Server?.AccessControl,
      AllowedOrigins: [
        ...(config.Server?.AccessControl?.AllowedOrigins ?? defaults.Server.AccessControl.AllowedOrigins),
      ],
      TrustedProxyAddresses: [
        ...(config.Server?.AccessControl?.TrustedProxyAddresses ?? defaults.Server.AccessControl.TrustedProxyAddresses),
      ],
      Session: {
        ...defaults.Server.AccessControl.Session,
        ...config.Server?.AccessControl?.Session,
      },
      Limits: {
        ...defaults.Server.AccessControl.Limits,
        ...config.Server?.AccessControl?.Limits,
      },
    },
  };
}

export function resolvePersistenceConfig(config: AgentSystemConfig): ResolvedAgentPersistenceConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Persistence,
    ...config.Persistence,
  };
}

export function resolveConfigStoreConfig(config: AgentSystemConfig): ResolvedAgentConfigStoreConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.ConfigStore,
    ...config.ConfigStore,
  };
}
