import type { ExecutedToolCallResult } from "./Types.js";
import type {
  AgentToolSearchEpisode,
  AgentToolSearchMemory,
} from "./AgentToolSearchMemory.js";
import {
  PendingToolSearch,
  ToolSearchToolName,
} from "./AgentToolSearchRuntimeTypes.js";
import { readToolNamesFromSearchResult } from "./AgentToolSearchResultProjector.js";

export class AgentToolSearchUsageMemory {
  private readonly pendingSearches = new Map<string, PendingToolSearch[]>();

  constructor(
    private readonly memory: AgentToolSearchMemory,
    private readonly projectId: string,
  ) {}

  rememberSearch(requestId: string, search: PendingToolSearch): void {
    const entries = this.pendingSearches.get(requestId) ?? [];
    this.pendingSearches.set(requestId, [...entries, search]);
  }

  recordToolUsage(
    requestId: string,
    results: ExecutedToolCallResult[],
  ): void {
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

    this.memory.record({
      query: relevant.query,
      queryTokens: relevant.queryTokens,
      plannerTags: relevant.plannerTags,
      candidates: relevant.candidates,
      chosenTools,
      outcome: results.some((result) => hasToolError(result.result)) ? "failure" : "success",
      projectId: this.projectId,
      timestamp: Date.now(),
    } satisfies AgentToolSearchEpisode);
    this.pendingSearches.delete(requestId);
  }

  extractSearchResultToolNames(results: ExecutedToolCallResult[]): string[] {
    return results
      .filter((result) => result.name === ToolSearchToolName)
      .flatMap((result) => readToolNamesFromSearchResult(result.result));
  }
}

function hasToolError(result: unknown): boolean {
  return Boolean(
    result
      && typeof result === "object"
      && !Array.isArray(result)
      && "error" in result,
  );
}
