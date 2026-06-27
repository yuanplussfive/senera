import type { ResolvedAgentToolLearningConfig } from "./Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "./Types/ToolRuntimeTypes.js";
import type {
  AgentToolSearchEpisode,
  AgentToolSearchMemory,
} from "./AgentToolSearchMemory.js";
import {
  PendingToolSearch,
  ToolSearchToolName,
} from "./AgentToolSearchRuntimeTypes.js";
import { readToolNamesFromSearchResult } from "./AgentToolSearchResultProjector.js";
import { assessToolSearchEpisode } from "./AgentToolSearchEpisodeScorer.js";
import type { AgentToolLearningEpisodeDraft } from "./AgentToolLearningRuntime.js";
import type { TurnUnderstanding } from "./BamlClient/baml_client/types.js";

export interface AgentToolLearningSink {
  enqueue(draft: AgentToolLearningEpisodeDraft): void;
}

export class AgentToolSearchUsageMemory {
  private readonly pendingSearches = new Map<string, PendingToolSearch[]>();

  constructor(
    private readonly memory: AgentToolSearchMemory,
    private readonly projectId: string,
    private readonly learningConfig: ResolvedAgentToolLearningConfig,
    private readonly learningRuntime?: AgentToolLearningSink,
  ) {}

  rememberSearch(requestId: string, search: PendingToolSearch): void {
    const entries = this.pendingSearches.get(requestId) ?? [];
    this.pendingSearches.set(requestId, [...entries, search]);
  }

  recordToolUsage(
    requestId: string,
    results: ExecutedToolCallResult[],
    turnUnderstanding?: TurnUnderstanding,
  ): void {
    if (!this.learningConfig.Enabled) {
      this.pendingSearches.delete(requestId);
      return;
    }

    const chosenTools = results
      .map((result) => result.name)
      .filter((name) => name !== ToolSearchToolName);
    if (chosenTools.length === 0) {
      return;
    }

    const pending = this.pendingSearches.get(requestId);
    if (!pending || pending.length === 0) {
      return;
    }

    const relevant = [...pending]
      .reverse()
      .find((entry) => chosenTools.some((name) => entry.candidates.includes(name)));
    if (!relevant) {
      return;
    }

    const assessment = assessToolSearchEpisode(
      results.filter((result) => result.name !== ToolSearchToolName),
    );
    if (assessment.outcome !== "success") {
      this.pendingSearches.delete(requestId);
      return;
    }

    const episode = {
      query: relevant.query,
      queryTokens: relevant.queryTokens,
      plannerTags: relevant.plannerTags,
      candidates: relevant.candidates,
      chosenTools,
      outcome: assessment.outcome,
      calls: assessment.calls,
      finalScore: assessment.finalScore,
      finalOutcome: assessment.finalOutcome,
      projectId: this.projectId,
      timestamp: Date.now(),
    } satisfies Omit<AgentToolSearchEpisode, "learnedKeywords">;
    const rawUserTurn = turnUnderstanding?.rawUserTurn ?? relevant.query;
    const standaloneRequest = turnUnderstanding?.standaloneRequest ?? relevant.query;
    this.learningRuntime?.enqueue({
      episode,
      rawUserTurn,
      standaloneRequest,
      contextMode: turnUnderstanding?.contextMode ?? "None",
      contextBasis: turnUnderstanding?.contextBasis ?? "",
    });
    this.pendingSearches.delete(requestId);
  }

  extractSearchResultToolNames(results: ExecutedToolCallResult[]): string[] {
    return results
      .filter((result) => result.name === ToolSearchToolName)
      .flatMap((result) => readToolNamesFromSearchResult(result.result));
  }
}
