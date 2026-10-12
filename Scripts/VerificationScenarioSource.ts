import type { AgentToolSearchEpisode } from "../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";
import type {
  AgentToolSearchScenarioMatch,
  AgentToolSearchScenarioSource,
} from "../Source/AgentSystem/ToolSearch/AgentToolSearchScenarioSource.js";

/** Explicit test double for standalone tool-catalog checks; production uses MemOS. */
export class VerificationScenarioSource implements AgentToolSearchScenarioSource {
  readonly recorded: AgentToolSearchEpisode[] = [];
  constructor(private readonly matches: readonly AgentToolSearchScenarioMatch[] = []) {}
  async search(_query: string, projectId: string, limit: number): Promise<readonly AgentToolSearchScenarioMatch[]> {
    return this.matches.filter((match) => match.episode.projectId === projectId).slice(0, limit);
  }
  record(episode: AgentToolSearchEpisode): void {
    this.recorded.push(structuredClone(episode));
  }
}
