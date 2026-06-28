import type { ResolvedAgentActionPlannerConfig } from "../Types/AgentConfigTypes.js";

export function isActionPlannerReady(config: ResolvedAgentActionPlannerConfig): boolean {
  return config.Enabled
    && isPlannerClientReady(config.TurnUnderstandingClient)
    && isPlannerClientReady(config.TaskFrameClient)
    && isPlannerClientReady(config.EvidenceClient);
}

function isPlannerClientReady(client: ResolvedAgentActionPlannerConfig["TaskFrameClient"]): boolean {
  return Boolean(client.BaseUrl.trim())
    && Boolean(client.ApiKey.trim())
    && Boolean(client.Model.trim());
}
