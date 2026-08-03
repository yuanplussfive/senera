import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { ResolvedAgentModelProviderConfig, ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolSearchResult } from "./AgentToolSearchTypes.js";

export const AgentToolDisclosureLevels = {
  Reference: "reference",
  Preview: "preview",
  Callable: "callable",
} as const;

export type AgentToolDisclosureLevel = (typeof AgentToolDisclosureLevels)[keyof typeof AgentToolDisclosureLevels];

export interface AgentDisclosedToolSearchResult extends AgentToolSearchResult {
  readonly disclosure: AgentToolDisclosureLevel;
}

export class AgentToolDisclosurePlanner {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(
    private readonly registry: Pick<AgentExtensionRegistry, "getTool">,
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly model: Pick<ResolvedAgentModelProviderConfig, "Model" | "ContextWindowTokens">,
  ) {
    this.estimator = new AgentModelTokenEstimator({ model: model.Model });
  }

  plan(
    query: string,
    results: readonly AgentToolSearchResult[],
    tokenBudget?: AgentToolTokenBudget,
  ): AgentDisclosedToolSearchResult[] {
    const bestScore = results[0]?.score;
    if (bestScore === undefined) return [];

    const exactName = normalizedIdentity(query);
    const frontier = new Set(
      results
        .filter(
          (result) =>
            normalizedIdentity(result.toolName) === exactName ||
            result.score >= bestScore * this.config.Ranking.MmrCandidateScoreRatio,
        )
        .map((result) => result.toolName),
    );
    let availableTokens = tokenBudget?.availableTokens() ?? this.model.ContextWindowTokens;
    let callableCount = 0;

    return results.map((result) => {
      if (!frontier.has(result.toolName)) {
        return { ...result, disclosure: AgentToolDisclosureLevels.Reference };
      }
      const schemaTokens = this.schemaTokens(result.toolName);
      const mandatoryWinner = callableCount === 0;
      if (mandatoryWinner || schemaTokens <= availableTokens) {
        callableCount += 1;
        availableTokens = Math.max(0, availableTokens - schemaTokens);
        return { ...result, disclosure: AgentToolDisclosureLevels.Callable };
      }
      return { ...result, disclosure: AgentToolDisclosureLevels.Preview };
    });
  }

  callableToolNames(results: readonly AgentDisclosedToolSearchResult[]): string[] {
    return results
      .filter((result) => result.disclosure === AgentToolDisclosureLevels.Callable)
      .map((result) => result.toolName);
  }

  private schemaTokens(toolName: string): number {
    const tool = this.registry.getTool(toolName);
    if (!tool) return 0;
    const descriptor = JSON.stringify({
      name: tool.name,
      description: tool.search?.Summary,
      parameters: tool.contract?.arguments?.jsonSchema,
    });
    return this.estimator.estimate(descriptor).tokenCount;
  }
}

function normalizedIdentity(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
