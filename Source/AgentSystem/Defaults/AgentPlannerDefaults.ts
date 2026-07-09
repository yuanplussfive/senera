import type {
  AgentActionPlannerClientConfig,
  AgentSystemConfig,
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentDefaults } from "./AgentDefaultValues.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { resolveModelProviderConfig } from "./AgentModelProviderDefaults.js";

export function resolveActionPlannerConfig(
  config: AgentSystemConfig,
  providerId?: string,
): ResolvedAgentActionPlannerConfig {
  const defaults = resolveAgentDefaults(config);
  const provider = resolveModelProviderConfig(config, providerId);
  const configured = config.ActionPlanner;
  const sharedClientConfig = mergeActionPlannerClientConfig(
    defaults.ActionPlanner.Client,
    configured?.Client,
  );
  const sharedClient = resolveActionPlannerClientConfig({
    config,
    baseProvider: provider,
    configuredClient: sharedClientConfig,
  });

  return {
    ...defaults.ActionPlanner,
    ...configured,
    Evidence: {
      ...defaults.ActionPlanner.Evidence,
      ...configured?.Evidence,
    },
    Client: sharedClient,
    TurnUnderstandingClient: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient: mergeActionPlannerClientConfig(
        sharedClientConfig,
        configured?.TurnUnderstandingClient,
      ),
    }),
    PlanningClient: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient: mergeActionPlannerClientConfig(
        sharedClientConfig,
        configured?.PlanningClient,
      ),
    }),
  };
}

export function resolveActionPlannerClientConfig(options: {
  config: AgentSystemConfig;
  baseProvider: ResolvedAgentModelProviderConfig;
  configuredClient: AgentActionPlannerClientConfig;
}): ResolvedAgentActionPlannerClientConfig {
  const configured = options.configuredClient;
  const modelProviderId = configured.ModelProviderId;
  const provider = modelProviderId
    ? resolveModelProviderConfig(options.config, modelProviderId)
    : options.baseProvider;
  const configuredProvider = configured.Provider;

  return {
    ModelProviderId: modelProviderId,
    Provider: configuredProvider ?? AgentDefaults.ActionPlanner.Client.Provider,
    BaseUrl: provider.BaseUrl,
    ApiKey: provider.ApiKey,
    Model: provider.Model,
    Temperature: configured.Temperature ?? AgentDefaults.ActionPlanner.Client.Temperature,
    MaxTokens: configured.MaxTokens ?? AgentDefaults.ActionPlanner.Client.MaxTokens,
  };
}

export function mergeActionPlannerClientConfig(
  base: AgentActionPlannerClientConfig,
  patch: AgentActionPlannerClientConfig | undefined,
): AgentActionPlannerClientConfig {
  return {
    ...base,
    ...patch,
  };
}
