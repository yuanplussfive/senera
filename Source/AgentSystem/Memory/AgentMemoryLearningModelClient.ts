import { type AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
} from "../ActionPlanner/AgentActionPlannerFailure.js";
import { parseMemoryConsolidationResult, parseMemoryLearningResult } from "./AgentMemoryLearningSchema.js";

export class AgentMemoryLearningModelClient {
  constructor(
    private readonly options: {
      client: AgentActionPlannerModelClient;
      maxRepairAttempts: number;
    },
  ) {}

  async learnAndValidate(
    input: AgentMemoryLearningPromptInput,
    options: {
      supportingSourceRefs: readonly string[];
    },
  ): Promise<ReturnType<typeof parseMemoryLearningResult>> {
    return this.runWithRepair({
      initial: () => this.options.client.learnMemory(input),
      parse: (current) =>
        parseMemoryLearningResult(current, {
          supportingSourceRefs: options.supportingSourceRefs,
        }),
      repair: (failure) =>
        this.options.client.repairMemoryLearning({
          input,
          invalidLearning: failure.invalidOutput,
          issues: failure.issues,
        }),
      failureMessage: "Memory learning validation did not produce a result.",
    });
  }

  async consolidateAndValidate(
    input: AgentMemoryConsolidationPromptInput,
    options: {
      candidateSources: ReadonlyMap<string, readonly string[]>;
      existingMemoryUris: readonly string[];
    },
  ): Promise<ReturnType<typeof parseMemoryConsolidationResult>> {
    return this.runWithRepair({
      initial: () => this.options.client.consolidateMemoryCandidates(input),
      parse: (current) =>
        parseMemoryConsolidationResult(current, {
          candidateSources: options.candidateSources,
          existingMemoryUris: options.existingMemoryUris,
        }),
      repair: (failure) =>
        this.options.client.repairMemoryConsolidation({
          input,
          invalidConsolidation: failure.invalidOutput,
          issues: failure.issues,
        }),
      failureMessage: "Memory consolidation validation did not produce a result.",
    });
  }

  private async runWithRepair<TModelOutput, TResult>(options: {
    initial: () => Promise<TModelOutput>;
    parse: (output: TModelOutput) => TResult;
    repair: (failure: { invalidOutput: string; issues: string[] }) => Promise<TModelOutput>;
    failureMessage: string;
  }): Promise<TResult> {
    let current = await options.initial();
    for (let attempt = 0; attempt <= this.options.maxRepairAttempts; attempt += 1) {
      try {
        return options.parse(current);
      } catch (error) {
        if (attempt >= this.options.maxRepairAttempts) {
          throw error;
        }
        const failure = normalizePlanningFailure(error);
        if (!isRepairablePlanningFailure(failure.error)) {
          throw error;
        }
        current = await options.repair({
          invalidOutput: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        });
      }
    }

    throw new Error(options.failureMessage);
  }
}
