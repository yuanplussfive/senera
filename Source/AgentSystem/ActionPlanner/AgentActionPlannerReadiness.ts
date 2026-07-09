import type { ResolvedAgentActionPlannerConfig } from "../Types/AgentConfigTypes.js";

export function isActionPlannerReady(config: ResolvedAgentActionPlannerConfig): boolean {
  return config.Enabled
    && isPlannerClientReady(config.TurnUnderstandingClient)
    && isPlannerClientReady(config.PlanningClient);
}

function isPlannerClientReady(client: ResolvedAgentActionPlannerConfig["PlanningClient"]): boolean {
  return Boolean(client.BaseUrl.trim())
    && Boolean(client.ApiKey.trim())
    && Boolean(client.Model.trim());
}
