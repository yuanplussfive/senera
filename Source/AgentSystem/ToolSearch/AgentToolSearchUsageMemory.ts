import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolSearchEpisode, AgentToolSearchMemory } from "./AgentToolSearchMemory.js";
import { AgentToolMetaToolNames, type PendingToolSearch } from "./AgentToolSearchRuntimeTypes.js";
import { readToolNamesFromSearchResult } from "./AgentToolSearchResultProjector.js";
import { assessToolSearchEpisode } from "./AgentToolSearchEpisodeScorer.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentStateCardRuntime } from "../StateCard/AgentStateCardRuntime.js";
import { type AgentStateCard, type AgentStateCardToolReference } from "../StateCard/AgentStateCardTypes.js";

export interface AgentToolSearchObservation {
  readonly requestId: string;
  readonly userInput: string;
  readonly sessionId?: string;
  readonly logicalCacheScope?: string;
  readonly activeSkills: readonly AgentActivatedSkill[];
  readonly stateCard?: AgentStateCard;
  readonly episode: AgentToolSearchEpisode;
  readonly standaloneRequest: string;
  readonly topicRelation?: AgentStateCard["topicRelation"];
}

export class AgentToolSearchUsageMemory {
  private readonly pendingSearches = new Map<string, PendingToolSearch[]>();

  constructor(
    private readonly memory: AgentToolSearchMemory,
    private readonly projectId: string,
    private readonly stateCardRuntime?: Pick<AgentStateCardRuntime, "recordTurn">,
  ) {}

  rememberSearch(requestId: string, search: PendingToolSearch): void {
    const entries = this.pendingSearches.get(requestId) ?? [];
    this.pendingSearches.set(requestId, [...entries, search]);
  }

  finishRequest(requestId: string): void {
    this.pendingSearches.delete(requestId);
  }

  observeToolUsage(options: {
    requestId: string;
    userInput: string;
    sessionId?: string;
    logicalCacheScope?: string;
    results: ExecutedToolCallResult[];
    activeSkills?: readonly AgentActivatedSkill[];
    stateCard?: AgentStateCard;
  }): AgentToolSearchObservation {
    const { requestId, results, userInput } = options;
    const chosenTools = results
      .map((result) => result.name)
      .filter((name) => !Object.values(AgentToolMetaToolNames).includes(name as never));
    const pending = this.pendingSearches.get(requestId) ?? [];
    const relevant =
      [...pending].reverse().find((entry) => chosenTools.some((name) => entry.candidates.includes(name))) ??
      (chosenTools.length === 0 ? pending.at(-1) : undefined);
    const assessment = assessToolSearchEpisode(
      results.filter((result) => !Object.values(AgentToolMetaToolNames).includes(result.name as never)),
    );
    const stateCard = options.stateCard;
    // The state card resolves follow-up turns into a standalone request. When
    // present it becomes the attribution text, so a bare follow-up is attributed
    // to the resolved task instead of the pronoun.
    const standaloneRequest = stateCard?.standaloneRequest ?? userInput;
    const episode: AgentToolSearchEpisode = {
      query: relevant?.query ?? standaloneRequest,
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
      activeSkills: (options.activeSkills ?? []).map((skill) => ({
        name: skill.name,
        revision: skill.revision,
      })),
      ...(stateCard ? { stateCard } : {}),
    };
    return {
      requestId,
      userInput,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.logicalCacheScope ? { logicalCacheScope: options.logicalCacheScope } : {}),
      activeSkills: options.activeSkills ?? [],
      ...(stateCard ? { stateCard } : {}),
      episode,
      standaloneRequest,
      ...(stateCard ? { topicRelation: stateCard.topicRelation } : {}),
    };
  }

  recordCompletedTurn(observation: AgentToolSearchObservation): void {
    const { episode, requestId, sessionId } = observation;
    if (!this.stateCardRuntime) {
      throw new Error("State-card runtime is required to finalize a routing scenario.");
    }
    this.stateCardRuntime.recordTurn({
      sessionId,
      request: observation.userInput,
      tools: projectToolReferences(episode.calls),
      artifacts: projectArtifactReferences(episode.calls),
    });
    // The completed turn is the scenario boundary. Every resolved state card
    // is durable training context, including turns that did not call a tool.
    if (!episode.stateCard) {
      throw new Error("Completed routing scenarios require the resolved state card.");
    }
    this.memory.record(episode, { sessionId, requestId });
    this.pendingSearches.delete(requestId);
  }

  extractSearchResultToolNames(results: ExecutedToolCallResult[]): string[] {
    return results
      .filter((result) => result.name === AgentToolMetaToolNames.Search)
      .flatMap((result) => readToolNamesFromSearchResult(result.result));
  }
}

function projectToolReferences(
  calls: readonly { toolName: string; status: "success" | "failure" | "empty" }[],
): AgentStateCardToolReference[] {
  return calls.map((call) => ({ name: call.toolName, status: call.status }));
}

function projectArtifactReferences(
  calls: readonly { artifactUris: readonly string[]; evidenceUris: readonly string[] }[],
): string[] {
  return [...new Set(calls.flatMap((call) => [...call.artifactUris, ...call.evidenceUris]).filter(Boolean))];
}
