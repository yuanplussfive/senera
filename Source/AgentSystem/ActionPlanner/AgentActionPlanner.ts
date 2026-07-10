import type { ActionPlanInput } from "../BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import {
  AgentActionPlannerModelClient,
  type AgentActionPlannerCoreClient,
} from "./AgentActionPlannerModelClient.js";
import {
  summarizePlannerFailure,
} from "./AgentActionPlannerFailure.js";
import type { AgentActionPlannerStageSink } from "./AgentActionPlannerTelemetry.js";
import { AgentCancellationError, throwIfAborted } from "../Core/AgentCancellation.js";
import {
  projectInteractionRoute,
  type AgentInteractionRouteResult,
} from "./AgentInteractionRouter.js";
import { AgentActionPlannerUnderstanding } from "./AgentActionPlannerUnderstanding.js";
import { isActionPlannerReady } from "./AgentActionPlannerReadiness.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export type {
  AgentActionCapabilityNeed,
  AgentActionDecision,
  AgentActionKind,
} from "./AgentActionPlannerTypes.js";
export {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "./AgentActionPlannerTypes.js";

export class AgentActionPlanner {
  private readonly turnUnderstandingClient: AgentActionPlannerCoreClient;
  private readonly planningClient: AgentActionPlannerCoreClient;
  private readonly understanding: AgentActionPlannerUnderstanding;

  constructor(
    private readonly config: ResolvedAgentActionPlannerConfig,
    model: ResolvedAgentModelProviderConfig,
    _catalog: unknown,
    dependencies: AgentActionPlannerDependencies = {},
  ) {
    const createClient = dependencies.createClient ?? createAgentActionPlannerClient;
    this.turnUnderstandingClient = createClient(model, config.TurnUnderstandingClient, config.MaxRepairAttempts);
    this.planningClient = createClient(model, config.PlanningClient, config.MaxRepairAttempts);
    this.understanding = new AgentActionPlannerUnderstanding(
      this.turnUnderstandingClient,
      config.MaxRepairAttempts,
    );
  }

  async understandTurn(options: {
    input: ActionPlanInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<ActionPlanInput> {
    if (!this.isEnabled()) {
      throw new Error(agentErrorMessage("actionPlanner.turnUnderstandingNotReady"));
    }

    try {
      throwIfAborted(options.signal);
      return await this.understanding.understandWithStage(
        options.input,
        options.onStage,
        options.signal,
      );
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      throw new Error(agentErrorMessage("actionPlanner.turnUnderstandingFailed", {
        reason: summarizePlannerFailure(error),
      }));
    }
  }

  async route(options: {
    input: ActionPlanInput;
    signal?: AbortSignal;
  }): Promise<AgentInteractionRouteResult> {
    return (await this.routeWithInput(options)).route;
  }

  async routeWithInput(options: {
    input: ActionPlanInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<{
    route: AgentInteractionRouteResult;
    input: ActionPlanInput;
  }> {
    if (!this.isEnabled()) {
      throw new Error(agentErrorMessage("actionPlanner.interactionRouterNotReady"));
    }

    try {
      throwIfAborted(options.signal);
      const input = await this.understanding.understandWithStage(options.input, options.onStage, options.signal);
      return {
        route: projectInteractionRoute(await this.planningClient.routeInteraction(input, {
          signal: options.signal,
        })),
        input,
      };
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      throw new Error(agentErrorMessage("actionPlanner.interactionRouterFailed", {
        reason: summarizePlannerFailure(error),
      }));
    }
  }

  private isEnabled(): boolean {
    return isActionPlannerReady(this.config);
  }
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
