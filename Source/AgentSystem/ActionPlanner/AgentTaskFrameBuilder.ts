import type {
  ActionPlanInput,
  TaskFrame,
} from "../BamlClient/baml_client/types.js";
import type { ResolvedAgentActionPlannerConfig } from "../Types/AgentConfigTypes.js";
import { parseTaskFrame } from "./AgentActionPlannerSchema.js";
import { runAgentActionPlannerRepairLoop } from "./AgentActionPlannerRepairLoop.js";
import type { AgentActionPlannerModelClient } from "./AgentActionPlannerModelClient.js";

export class AgentTaskFrameBuilder {
  constructor(
    private readonly client: AgentActionPlannerModelClient,
    private readonly maxRepairAttempts: ResolvedAgentActionPlannerConfig["MaxRepairAttempts"],
  ) {}

  async buildOrRepair(input: ActionPlanInput, signal?: AbortSignal): Promise<{
    value: TaskFrame;
    repaired: boolean;
  }> {
    try {
      return {
        value: parseTaskFrame(await this.client.buildTaskFrame(input, { signal }), input),
        repaired: false,
      };
    } catch (error) {
      return this.repairUntilParsed(input, error, signal);
    }
  }

  private async repairUntilParsed(
    input: ActionPlanInput,
    initialError: unknown,
    signal?: AbortSignal,
  ): Promise<{
    value: TaskFrame;
    repaired: boolean;
  }> {
    return runAgentActionPlannerRepairLoop({
      initialError,
      maxAttempts: this.maxRepairAttempts,
      signal,
      repair: async ({ invalidOutput, issues }) => {
        const repaired = await this.client.repairTaskFrame({
          input,
          invalidTaskFrame: invalidOutput,
          issues,
        }, { signal });
        return {
          value: parseTaskFrame(repaired, input),
          repaired: true,
        };
      },
    });
  }
}
