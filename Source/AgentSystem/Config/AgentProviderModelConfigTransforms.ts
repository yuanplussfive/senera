import type {
  AgentModelGroupConfig,
  AgentModelGroupStrategyConfig,
  AgentModelProviderConfig,
  AgentSystemConfig,
} from "../Types/AgentConfigTypes.js";

interface AgentProviderModelGroupAssignment {
  groupId: string;
  label?: string;
  icon?: string;
}

export function cloneModelProviderConfig(model: AgentModelProviderConfig): AgentModelProviderConfig {
  return {
    ...model,
    ...(model.Capabilities ? { Capabilities: { ...model.Capabilities } } : {}),
  };
}

export function remapModelIdReferences(
  config: AgentSystemConfig,
  modelIdRenames: ReadonlyMap<string, string>,
): AgentSystemConfig {
  const remap = (modelId: string | undefined) =>
    modelId === undefined ? undefined : (modelIdRenames.get(modelId) ?? modelId);
  const nextConfig: AgentSystemConfig = {
    ...config,
    DefaultModelProviderId: remap(config.DefaultModelProviderId),
    ModelGroups: config.ModelGroups?.map((group) => remapModelGroupIds(group, modelIdRenames)),
  };

  if (config.ActionPlanner) {
    nextConfig.ActionPlanner = remapActionPlannerModelIds(config.ActionPlanner, remap);
  }
  if (config.ToolLearning) {
    nextConfig.ToolLearning = {
      ...config.ToolLearning,
      Client: remapPlannerClientModelId(config.ToolLearning.Client, remap),
    };
  }
  if (config.ToolSearch) {
    nextConfig.ToolSearch = remapToolSearchModelId(config.ToolSearch, remap);
  }
  if (config.Defaults) {
    nextConfig.Defaults = { ...config.Defaults };
    if (config.Defaults.ActionPlanner) {
      nextConfig.Defaults.ActionPlanner = remapActionPlannerModelIds(config.Defaults.ActionPlanner, remap);
    }
    if (config.Defaults.ToolLearning) {
      nextConfig.Defaults.ToolLearning = {
        ...config.Defaults.ToolLearning,
        Client: remapPlannerClientModelId(config.Defaults.ToolLearning.Client, remap),
      };
    }
    if (config.Defaults.ToolSearch) {
      nextConfig.Defaults.ToolSearch = remapToolSearchModelId(config.Defaults.ToolSearch, remap);
    }
  }
  return nextConfig;
}

export function withOptionalDefaultModelId(
  config: AgentSystemConfig,
  defaultModelId: string | undefined,
): AgentSystemConfig {
  const nextConfig = {
    ...config,
    ModelProviderEndpoints: config.ModelProviderEndpoints?.map((endpoint) => ({ ...endpoint })),
    ModelProviders: config.ModelProviders.map(cloneModelProviderConfig),
    ModelGroups: config.ModelGroups?.map(cloneModelGroup),
  };
  if (defaultModelId === undefined) {
    delete nextConfig.DefaultModelProviderId;
  } else {
    nextConfig.DefaultModelProviderId = defaultModelId;
  }
  return nextConfig;
}

export function applyOptionalGroupAssignment(
  config: AgentSystemConfig,
  modelId: string,
  assignment: AgentProviderModelGroupAssignment | undefined,
): AgentSystemConfig {
  if (!assignment) {
    return config;
  }

  const groups = removeExactModelGroupAssignments(config.ModelGroups ?? [], modelId);
  const targetIndex = groups.findIndex((group) => group.Id === assignment.groupId);
  const target =
    targetIndex >= 0
      ? addExactModelGroupAssignment(groups[targetIndex], modelId, assignment)
      : {
          Id: assignment.groupId,
          Label: assignment.label ?? assignment.groupId,
          Icon: assignment.icon,
          Strategies: [
            {
              Match: "exact" as const,
              Values: [modelId],
            },
          ],
        };

  const nextGroups =
    targetIndex >= 0 ? groups.map((group, index) => (index === targetIndex ? target : group)) : [...groups, target];

  return {
    ...config,
    ModelGroups: nextGroups,
  };
}

export function removeExactModelGroupAssignments(
  groups: readonly AgentModelGroupConfig[],
  modelIds: string | ReadonlySet<string>,
): AgentModelGroupConfig[] {
  const ids = typeof modelIds === "string" ? new Set([modelIds]) : modelIds;
  return groups.map((group) => {
    const nextGroup = cloneModelGroup(group);
    if (nextGroup.Match === "exact" && nextGroup.Values) {
      nextGroup.Values = nextGroup.Values.filter((value) => !ids.has(value));
    }
    if (nextGroup.Strategies) {
      nextGroup.Strategies = nextGroup.Strategies.map((strategy) =>
        strategy.Match === "exact"
          ? {
              ...strategy,
              Values: strategy.Values.filter((value) => !ids.has(value)),
            }
          : strategy,
      ).filter((strategy) => strategy.Match !== "exact" || strategy.Values.length > 0);
    }
    return nextGroup;
  });
}

export function cloneModelGroup(group: AgentModelGroupConfig): AgentModelGroupConfig {
  return {
    ...group,
    Values: group.Values ? [...group.Values] : undefined,
    Strategies: group.Strategies?.map((strategy) => ({
      ...strategy,
      Values: [...strategy.Values],
    })),
  };
}

function remapActionPlannerModelIds(
  planner: NonNullable<AgentSystemConfig["ActionPlanner"]>,
  remap: (modelId: string | undefined) => string | undefined,
): NonNullable<AgentSystemConfig["ActionPlanner"]> {
  return {
    ...planner,
    Client: remapPlannerClientModelId(planner.Client, remap),
    PlanningClient: remapPlannerClientModelId(planner.PlanningClient, remap),
    FinalAnswerClient: remapPlannerClientModelId(planner.FinalAnswerClient, remap),
  };
}

function remapPlannerClientModelId<T extends { ModelProviderId?: string }>(
  client: T | undefined,
  remap: (modelId: string | undefined) => string | undefined,
): T | undefined {
  return client
    ? {
        ...client,
        ModelProviderId: remap(client.ModelProviderId),
      }
    : undefined;
}

function remapToolSearchModelId(
  toolSearch: NonNullable<AgentSystemConfig["ToolSearch"]>,
  remap: (modelId: string | undefined) => string | undefined,
): NonNullable<AgentSystemConfig["ToolSearch"]> {
  return {
    ...toolSearch,
    Embedding: toolSearch.Embedding
      ? {
          ...toolSearch.Embedding,
          ModelProviderId: remap(toolSearch.Embedding.ModelProviderId),
        }
      : undefined,
  };
}

function remapModelGroupIds(
  group: AgentModelGroupConfig,
  modelIdRenames: ReadonlyMap<string, string>,
): AgentModelGroupConfig {
  const remapValues = (values: readonly string[]) => values.map((value) => modelIdRenames.get(value) ?? value);
  const nextGroup = cloneModelGroup(group);
  if (nextGroup.Match === "exact" && nextGroup.Values) {
    nextGroup.Values = remapValues(nextGroup.Values);
  }
  if (nextGroup.Strategies) {
    nextGroup.Strategies = nextGroup.Strategies.map((strategy) =>
      strategy.Match === "exact"
        ? {
            ...strategy,
            Values: remapValues(strategy.Values),
          }
        : strategy,
    );
  }
  return nextGroup;
}

function addExactModelGroupAssignment(
  group: AgentModelGroupConfig,
  modelId: string,
  assignment: AgentProviderModelGroupAssignment,
): AgentModelGroupConfig {
  const nextGroup = {
    ...cloneModelGroup(group),
    Label: assignment.label ?? group.Label,
    Icon: assignment.icon ?? group.Icon,
  };

  const strategies = nextGroup.Strategies ? [...nextGroup.Strategies] : [];
  const exactIndex = strategies.findIndex((strategy) => strategy.Match === "exact");
  if (exactIndex >= 0) {
    strategies[exactIndex] = addModelIdToStrategy(strategies[exactIndex], modelId);
  } else {
    strategies.push({
      Match: "exact",
      Values: [modelId],
    });
  }
  nextGroup.Strategies = strategies;
  return nextGroup;
}

function addModelIdToStrategy(strategy: AgentModelGroupStrategyConfig, modelId: string): AgentModelGroupStrategyConfig {
  return strategy.Values.includes(modelId)
    ? { ...strategy, Values: [...strategy.Values] }
    : { ...strategy, Values: [...strategy.Values, modelId] };
}
