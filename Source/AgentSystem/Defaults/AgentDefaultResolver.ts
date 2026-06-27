import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentDefaults } from "./AgentDefaultValues.js";
import type { ResolvedAgentDefaultsConfig } from "./AgentDefaultValues.js";
import { resolveAgentDelegationDefaults } from "./AgentDelegationProfileCore.js";
import {
  disabledOrSecondsToMilliseconds,
  secondsToMilliseconds,
} from "./AgentTimeDefaults.js";

export function resolveAgentDefaults(
  config: Pick<AgentSystemConfig, "Defaults"> | undefined,
): ResolvedAgentDefaultsConfig {
  const defaults = config?.Defaults;

  return {
    PluginRoots: {
      System: defaults?.PluginRoots?.System ?? [...AgentDefaults.PluginRoots.System],
      User: defaults?.PluginRoots?.User ?? [...AgentDefaults.PluginRoots.User],
    },
    PluginDiscovery: {
      ...AgentDefaults.PluginDiscovery,
      ...defaults?.PluginDiscovery,
    },
    ModelProviderEndpoints: AgentDefaults.ModelProviderEndpoints.map((endpoint) => ({ ...endpoint })),
    ModelRuntime: {
      ...AgentDefaults.ModelRuntime,
      ...defaultModelRuntimeMilliseconds(AgentDefaults.ModelRuntime),
    },
    Cli: {
      Connection: {
        ...AgentDefaults.Cli.Connection,
        ...defaults?.Cli?.Connection,
      },
      Display: {
        ...AgentDefaults.Cli.Display,
        ...defaults?.Cli?.Display,
      },
    },
    ToolExecution: {
      Mode: defaults?.ToolExecution?.Mode ?? AgentDefaults.ToolExecution.Mode,
      TimeoutMs: secondsToMilliseconds(
        defaults?.ToolExecution?.TimeoutSeconds
          ?? AgentDefaults.ToolExecution.TimeoutSeconds,
      ),
      MaxStdoutBytes: defaults?.ToolExecution?.MaxStdoutBytes ?? AgentDefaults.ToolExecution.MaxStdoutBytes,
      MaxStderrBytes: defaults?.ToolExecution?.MaxStderrBytes ?? AgentDefaults.ToolExecution.MaxStderrBytes,
    },
    AgentLoop: {
      ...AgentDefaults.AgentLoop,
      ...defaults?.AgentLoop,
    },
    AgentDelegation: resolveAgentDelegationDefaults(defaults?.AgentDelegation, {
      ...AgentDefaults.AgentLoop,
      ...defaults?.AgentLoop,
    }),
    ToolSearch: {
      Embedding: {
        ...AgentDefaults.ToolSearch.Embedding,
        ...defaults?.ToolSearch?.Embedding,
      },
      Memory: {
        ...AgentDefaults.ToolSearch.Memory,
        ...defaults?.ToolSearch?.Memory,
      },
      Ranking: {
        ...AgentDefaults.ToolSearch.Ranking,
        ...defaults?.ToolSearch?.Ranking,
      },
      Rerank: {
        ...AgentDefaults.ToolSearch.Rerank,
        ...defaults?.ToolSearch?.Rerank,
        FeatureWeights: {
          ...AgentDefaults.ToolSearch.Rerank.FeatureWeights,
          ...defaults?.ToolSearch?.Rerank?.FeatureWeights,
        },
      },
    },
    VectorModels: {
      Embedding: {
        ...AgentDefaults.VectorModels.Embedding,
        ...defaults?.VectorModels?.Embedding,
        TimeoutMs: secondsToMilliseconds(
          defaults?.VectorModels?.Embedding?.TimeoutSeconds
            ?? AgentDefaults.VectorModels.Embedding.TimeoutSeconds,
        ),
      },
      Rerank: {
        ...AgentDefaults.VectorModels.Rerank,
        ...defaults?.VectorModels?.Rerank,
        TimeoutMs: secondsToMilliseconds(
          defaults?.VectorModels?.Rerank?.TimeoutSeconds
            ?? AgentDefaults.VectorModels.Rerank.TimeoutSeconds,
        ),
      },
    },
    ToolLearning: {
      ...AgentDefaults.ToolLearning,
      ...defaults?.ToolLearning,
      Patterns: {
        ...AgentDefaults.ToolLearning.Patterns,
        ...defaults?.ToolLearning?.Patterns,
      },
      Client: {
        ...AgentDefaults.ToolLearning.Client,
        ...defaults?.ToolLearning?.Client,
      },
    },
    MemoryLearning: {
      Promotion: {
        ...AgentDefaults.MemoryLearning.Promotion,
        ...defaults?.MemoryLearning?.Promotion,
      },
    },
    Presets: {
      ...AgentDefaults.Presets,
      ...defaults?.Presets,
    },
    ActionPlanner: {
      ...AgentDefaults.ActionPlanner,
      ...defaults?.ActionPlanner,
      Evidence: {
        ...AgentDefaults.ActionPlanner.Evidence,
        ...defaults?.ActionPlanner?.Evidence,
      },
      Client: {
        ...AgentDefaults.ActionPlanner.Client,
        ...defaults?.ActionPlanner?.Client,
      },
      TurnUnderstandingClient: {
        ...AgentDefaults.ActionPlanner.TurnUnderstandingClient,
        ...defaults?.ActionPlanner?.TurnUnderstandingClient,
      },
      TaskFrameClient: {
        ...AgentDefaults.ActionPlanner.TaskFrameClient,
        ...defaults?.ActionPlanner?.TaskFrameClient,
      },
      EvidenceClient: {
        ...AgentDefaults.ActionPlanner.EvidenceClient,
        ...defaults?.ActionPlanner?.EvidenceClient,
      },
    },
    Artifacts: {
      ...AgentDefaults.Artifacts,
      ...defaults?.Artifacts,
    },
    Uploads: {
      ...AgentDefaults.Uploads,
      ...defaults?.Uploads,
    },
    Frontend: {
      DevServer: {
        ...AgentDefaults.Frontend.DevServer,
        ...defaults?.Frontend?.DevServer,
      },
      PreviewServer: {
        ...AgentDefaults.Frontend.PreviewServer,
        ...defaults?.Frontend?.PreviewServer,
      },
      Client: {
        ...AgentDefaults.Frontend.Client,
        ...defaults?.Frontend?.Client,
      },
    },
    Server: {
      ...AgentDefaults.Server,
      ...defaults?.Server,
    },
    Persistence: {
      ...AgentDefaults.Persistence,
      ...defaults?.Persistence,
    },
    ConfigStore: {
      ...AgentDefaults.ConfigStore,
      ...defaults?.ConfigStore,
    },
  };
}

function defaultModelRuntimeMilliseconds(
  runtime: typeof AgentDefaults.ModelRuntime,
): {
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
} {
  return {
    TimeoutMs: secondsToMilliseconds(runtime.TimeoutSeconds),
    FirstTokenTimeoutMs: disabledOrSecondsToMilliseconds(runtime.FirstTokenTimeoutSeconds),
    MaxRequestMs: disabledOrSecondsToMilliseconds(runtime.MaxRequestSeconds),
  };
}
