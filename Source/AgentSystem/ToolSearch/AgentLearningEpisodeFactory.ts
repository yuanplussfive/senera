import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import {
  AgentLearningStates,
  type AgentLearningDomain,
  type AgentLearningEpisode,
  type AgentLearningSubject,
} from "./AgentLearningEpisodeTypes.js";
import type { AgentToolSearchEpisode } from "./AgentToolSearchMemoryTypes.js";

export function createAgentLearningEpisode(input: {
  domain: AgentLearningDomain;
  requestId: string;
  sessionId?: string;
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  activeSkills: readonly AgentActivatedSkill[];
  episode: Omit<AgentToolSearchEpisode, "learnedKeywords">;
  subjects: readonly AgentLearningSubject[];
  now?: number;
}): AgentLearningEpisode {
  const now = input.now ?? Date.now();
  return {
    id: createOpaqueId("learning"),
    domain: input.domain,
    state: AgentLearningStates.Observed,
    reason: "",
    error: "",
    attempts: 0,
    projectId: input.episode.projectId,
    sessionId: input.sessionId ?? "",
    requestId: input.requestId,
    query: input.episode.query,
    subjects: input.subjects.map((subject) => ({ ...subject })),
    context: {
      rawUserTurn: input.rawUserTurn,
      standaloneRequest: input.standaloneRequest,
      contextMode: input.contextMode,
      contextBasis: input.contextBasis,
      candidates: [...input.episode.candidates],
      chosenTools: [...input.episode.chosenTools],
      activeSkills: input.activeSkills.map((skill) => ({
        name: skill.name,
        revision: skill.revision,
        matchedTerms: [...skill.matchedTerms],
      })),
    },
    outcome: {
      outcome: input.episode.outcome,
      score: input.episode.finalScore,
      calls: input.episode.calls.map((call) => structuredClone(call)),
      final: { ...input.episode.finalOutcome },
    },
    createdAtMs: now,
    updatedAtMs: now,
  };
}
