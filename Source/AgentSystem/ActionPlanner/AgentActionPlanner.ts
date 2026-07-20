import type { ActionPlanInput } from "../BamlClient/baml_client/types.js";
import type { ResolvedAgentActionPlannerConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentActionPlannerModelClient, type AgentActionPlannerCoreClient } from "./AgentActionPlannerModelClient.js";
import { summarizePlannerFailure } from "./AgentActionPlannerFailure.js";
import type { AgentActionPlannerStageSink } from "./AgentActionPlannerTelemetry.js";
import { AgentCancellationError, throwIfAborted } from "../Core/AgentCancellation.js";
import { projectPreparedInteractionRoute, type AgentInteractionRouteResult } from "./AgentInteractionRouter.js";
import { isActionPlannerReady } from "./AgentActionPlannerReadiness.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentPiToolCard } from "../PiProxy/AgentPiAssistantMessageTypes.js";

export type { AgentActionCapabilityNeed, AgentActionDecision, AgentActionKind } from "./AgentActionPlannerTypes.js";
export {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "./AgentActionPlannerTypes.js";

export class AgentActionPlanner {
  private readonly planningClient: AgentActionPlannerCoreClient;

  constructor(
    private readonly config: ResolvedAgentActionPlannerConfig,
    model: ResolvedAgentModelProviderConfig,
    _catalog: unknown,
    dependencies: AgentActionPlannerDependencies = {},
  ) {
    const createClient = dependencies.createClient ?? createAgentActionPlannerClient;
    this.planningClient = createClient(model, config.PlanningClient, config.MaxRepairAttempts);
  }

  async prepareInteraction(options: {
    input: ActionPlanInput;
    candidateTools?: readonly AgentPiToolCard[];
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<{
    route: AgentInteractionRouteResult;
    input: ActionPlanInput;
    initialAction: import("../PiProxy/AgentPiAssistantMessageSchema.js").ParsedPiControllerAction;
  }> {
    if (!this.isEnabled()) {
      throw new Error(agentErrorMessage("actionPlanner.interactionRouterNotReady"));
    }

    const startedAt = performance.now();
    try {
      throwIfAborted(options.signal);
      await options.onStage?.({ status: "started", stage: "prepareInteraction" });
      const preparation = await this.planningClient.prepareInteraction(options.input, {
        candidateTools: options.candidateTools,
        signal: options.signal,
      });
      const input = {
        ...options.input,
        turnUnderstanding: preparation.turnUnderstanding,
      };
      await options.onStage?.({
        status: "completed",
        stage: "prepareInteraction",
        durationMs: elapsedMilliseconds(startedAt),
        preparation,
      });
      return {
        route: projectPreparedInteractionRoute(preparation),
        input,
        initialAction: preparation.initialAction,
      };
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      const reason = summarizePlannerFailure(error);
      await options.onStage?.({
        status: "failed",
        stage: "prepareInteraction",
        durationMs: elapsedMilliseconds(startedAt),
        message: reason,
      });
      throw new Error(
        agentErrorMessage("actionPlanner.interactionRouterFailed", {
          reason,
        }),
        { cause: error },
      );
    }
  }

  private isEnabled(): boolean {
    return isActionPlannerReady(this.config);
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export interface AgentActionPlannerDependencies {
  createClient?: (
    model: ResolvedAgentModelProviderConfig,
    config: ResolvedAgentActionPlannerConfig["Client"],
    maxRepairAttempts: number,
  ) => AgentActionPlannerCoreClient;
}

function createAgentActionPlannerClient(
  model: ResolvedAgentModelProviderConfig,
  config: ResolvedAgentActionPlannerConfig["Client"],
  maxRepairAttempts: number,
): AgentActionPlannerCoreClient {
  return new AgentActionPlannerModelClient(model, config, {
    maxRepairAttempts,
  });
}
