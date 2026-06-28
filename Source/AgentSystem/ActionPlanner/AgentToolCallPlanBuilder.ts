import type { AgentToolCallPlannerPromptInput } from "../AgentToolCallPlannerPromptJson.js";
import {
  parseToolCallPlan,
  type AgentParsedToolCallPlan,
} from "../AgentToolCallPlannerSchema.js";
import type { ResolvedAgentActionPlannerConfig } from "../Types/AgentConfigTypes.js";
import { runAgentActionPlannerRepairLoop } from "./AgentActionPlannerRepairLoop.js";
import type { AgentActionPlannerStageSink } from "./AgentActionPlannerTelemetry.js";
import type { AgentActionPlannerModelClient } from "./AgentActionPlannerModelClient.js";
import type { AgentActionPlannerUnderstanding } from "./AgentActionPlannerUnderstanding.js";

export class AgentToolCallPlanBuilder {
  constructor(
    private readonly client: AgentActionPlannerModelClient,
    private readonly understanding: AgentActionPlannerUnderstanding,
    private readonly maxRepairAttempts: ResolvedAgentActionPlannerConfig["MaxRepairAttempts"],
  ) {}

  async prepareInput(
    input: AgentToolCallPlannerPromptInput,
    signal?: AbortSignal,
    onStage?: AgentActionPlannerStageSink,
  ): Promise<AgentToolCallPlannerPromptInput> {
    return {
      ...input,
      actionInput: await this.understanding.understandWithStage(input.actionInput, onStage, signal),
    };
  }

  async buildOrRepair(
    input: AgentToolCallPlannerPromptInput,
    signal?: AbortSignal,
  ): Promise<AgentParsedToolCallPlan & { repaired: boolean }> {
    try {
      return {
        ...parseToolCallPlan(await this.client.planToolCalls(input, { signal }), {
          allowedTools: input.rootCommand.allowedTools,
          toolContracts: input.toolContracts,
        }),
        repaired: false,
      };
    } catch (error) {
      return this.repairUntilParsed(input, error, signal);
    }
  }

  private async repairUntilParsed(
    input: AgentToolCallPlannerPromptInput,
    initialError: unknown,
    signal?: AbortSignal,
  ): Promise<AgentParsedToolCallPlan & { repaired: boolean }> {
    return runAgentActionPlannerRepairLoop({
      initialError,
      maxAttempts: this.maxRepairAttempts,
      signal,
      repair: async ({ invalidOutput, issues }) => {
        const repaired = await this.client.repairToolCallPlan({
          input,
          invalidPlan: invalidOutput,
          issues,
        }, { signal });
        return {
          ...parseToolCallPlan(repaired, {
            allowedTools: input.rootCommand.allowedTools,
            toolContracts: input.toolContracts,
          }),
          repaired: true,
        };
      },
    });
  }
}
