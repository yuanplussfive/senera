import type { ActionPlanInput } from "../BamlClient/baml_client/types.js";
import type { ResolvedAgentActionPlannerConfig } from "../Types/AgentConfigTypes.js";
import {
  parseTurnUnderstanding,
} from "./AgentActionPlannerSchema.js";
import {
  AgentActionPlannerStageNames,
  type AgentActionPlannerStageSink,
} from "./AgentActionPlannerTelemetry.js";
import { runAgentActionPlannerStage } from "./AgentActionPlannerStageRunner.js";
import { runAgentActionPlannerRepairLoop } from "./AgentActionPlannerRepairLoop.js";
import type { AgentActionPlannerCoreClient } from "./AgentActionPlannerModelClient.js";

export class AgentActionPlannerUnderstanding {
  constructor(
    private readonly client: AgentActionPlannerCoreClient,
    private readonly maxRepairAttempts: ResolvedAgentActionPlannerConfig["MaxRepairAttempts"],
  ) {}

  async understandWithStage(
    input: ActionPlanInput,
    onStage: AgentActionPlannerStageSink | undefined,
    signal?: AbortSignal,
  ): Promise<ActionPlanInput> {
    if (input.turnUnderstanding) {
      return input;
    }

    return runAgentActionPlannerStage(
      AgentActionPlannerStageNames.UnderstandUserTurn,
      onStage,
      () => this.understand(input, signal),
      (result) => ({
        turnUnderstanding: result.turnUnderstanding ?? undefined,
      }),
    );
  }

  private async understand(
    input: ActionPlanInput,
    signal?: AbortSignal,
  ): Promise<ActionPlanInput> {
    if (input.turnUnderstanding) {
      return input;
    }

    try {
      const understanding = parseTurnUnderstanding(
        await this.client.understandUserTurn(input, { signal }),
        input,
      );
      return {
        ...input,
        turnUnderstanding: understanding,
      };
    } catch (error) {
      return {
        ...input,
        turnUnderstanding: await this.repairUntilParsed(input, error, signal),
      };
    }
  }

  private async repairUntilParsed(
    input: ActionPlanInput,
    initialError: unknown,
    signal?: AbortSignal,
  ): Promise<NonNullable<ActionPlanInput["turnUnderstanding"]>> {
    return runAgentActionPlannerRepairLoop({
      initialError,
      maxAttempts: this.maxRepairAttempts,
      signal,
      repair: async ({ invalidOutput, issues }) => {
        const repaired = await this.client.repairTurnUnderstanding({
          input,
          invalidUnderstanding: invalidOutput,
          issues,
        }, { signal });
        return parseTurnUnderstanding(repaired, input);
      },
    });
  }
}
