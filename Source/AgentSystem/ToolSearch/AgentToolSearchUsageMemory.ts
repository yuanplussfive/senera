import type { ResolvedAgentToolLearningConfig } from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolSearchEpisode, AgentToolSearchMemory } from "./AgentToolSearchMemory.js";
import { type PendingToolSearch, ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";
import { readToolNamesFromSearchResult } from "./AgentToolSearchResultProjector.js";
import { assessToolSearchEpisode } from "./AgentToolSearchEpisodeScorer.js";
import type { AgentToolLearningEpisodeDraft } from "./AgentToolLearningRuntime.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import { AgentLearningDomains, AgentLearningStates } from "./AgentLearningEpisodeTypes.js";
import { createAgentLearningEpisode } from "./AgentLearningEpisodeFactory.js";
import type { AgentSkillLearningRuntime } from "./AgentSkillLearningRuntime.js";

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
    private readonly skillLearningRuntime?: Pick<AgentSkillLearningRuntime, "learn">,
  ) {}

  rememberSearch(requestId: string, search: PendingToolSearch): void {
    const entries = this.pendingSearches.get(requestId) ?? [];
    this.pendingSearches.set(requestId, [...entries, search]);
  }

  finishRequest(requestId: string): void {
    this.pendingSearches.delete(requestId);
  }

  recordToolUsage(options: {
    requestId: string;
    userInput: string;
    sessionId?: string;
    results: ExecutedToolCallResult[];
    activeSkills?: readonly AgentActivatedSkill[];
  }): void {
    const { requestId, results, userInput } = options;
    const chosenTools = results.map((result) => result.name).filter((name) => name !== ToolSearchToolName);
    const pending = this.pendingSearches.get(requestId) ?? [];
    const relevant =
      [...pending].reverse().find((entry) => chosenTools.some((name) => entry.candidates.includes(name))) ??
      (chosenTools.length === 0 ? pending.at(-1) : undefined);
    const assessment = assessToolSearchEpisode(results.filter((result) => result.name !== ToolSearchToolName));
    const episode = {
      query: relevant?.query ?? userInput,
      queryTokens: relevant?.queryTokens ?? [],
      plannerTags: relevant?.plannerTags ?? [],
      candidates: relevant?.candidates ?? [],
      chosenTools,
      outcome: assessment.outcome,
      calls: assessment.calls,
      finalScore: assessment.finalScore,
      finalOutcome: assessment.finalOutcome,
      projectId: this.projectId,
      timestamp: Date.now(),
    } satisfies Omit<AgentToolSearchEpisode, "learnedKeywords">;
    const rawUserTurn = userInput;
    const standaloneRequest = relevant?.query ?? userInput;
    const draftBase = {
      episode,
      requestId,
      sessionId: options.sessionId,
      rawUserTurn,
      standaloneRequest,
      contextMode: "None",
      contextBasis: "",
      activeSkills: options.activeSkills ?? [],
    };
    this.skillLearningRuntime?.learn(draftBase);

    if (!this.learningConfig.Enabled || (pending.length === 0 && chosenTools.length === 0)) {
      this.pendingSearches.delete(requestId);
      return;
    }

    const observation = createAgentLearningEpisode({
      domain: AgentLearningDomains.ToolRouting,
      requestId,
      sessionId: options.sessionId,
      rawUserTurn,
      standaloneRequest,
      contextMode: draftBase.contextMode,
      contextBasis: draftBase.contextBasis,
      activeSkills: draftBase.activeSkills,
      episode,
      subjects: chosenTools.map((name) => ({ kind: "tool", name })),
    });
    this.memory.recordLearningEpisode(observation);
    const skipReason =
      chosenTools.length === 0
        ? "no non-discovery tool was executed after ToolSearch"
        : !relevant
          ? "no selected tool matched a pending ToolSearch candidate"
          : assessment.outcome !== "success"
            ? "selected tool execution did not produce a grounded successful outcome"
            : undefined;
    if (skipReason) {
      this.memory.resolveLearningEpisode(observation.id, {
        state: AgentLearningStates.Skipped,
        reason: skipReason,
        updatedAtMs: Date.now(),
      });
    } else if (this.learningRuntime) {
      this.learningRuntime?.enqueue({ ...draftBase, learningEpisodeId: observation.id });
    } else {
      this.memory.resolveLearningEpisode(observation.id, {
        state: AgentLearningStates.Skipped,
        reason: "tool learning runtime is unavailable",
        updatedAtMs: Date.now(),
      });
    }
    this.pendingSearches.delete(requestId);
  }

  extractSearchResultToolNames(results: ExecutedToolCallResult[]): string[] {
    return results
      .filter((result) => result.name === ToolSearchToolName)
      .flatMap((result) => readToolNamesFromSearchResult(result.result));
  }
}
