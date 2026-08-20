import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import {
  AgentLearningDomains,
  AgentLearningStates,
  type AgentLearningSubject,
  type AgentSkillLearningTermAggregate,
} from "./AgentLearningEpisodeTypes.js";
import { createAgentLearningEpisode } from "./AgentLearningEpisodeFactory.js";
import { AgentToolSearchMemory } from "./AgentToolSearchMemory.js";
import type { AgentToolSearchEpisode, AgentToolSearchEpisodeCall } from "./AgentToolSearchMemoryTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { isGroundedSuccessfulToolSearchCall } from "./AgentToolSearchEpisodeScorer.js";

const SkillLearningReasons = {
  Learned: "skill routing terms learned from grounded successful use",
  NoGroundedOutcome: "active Skill use produced no successful evidence, artifact, or workspace change",
  AmbiguousAttribution: "multiple active Skills could not be attributed to successful tool use",
  NoTerms: "the completed request contained no reusable Skill routing terms",
} as const;

export interface AgentSkillLearningEpisodeDraft {
  episode: Omit<AgentToolSearchEpisode, "learnedKeywords">;
  requestId: string;
  sessionId?: string;
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  activeSkills: readonly AgentActivatedSkill[];
}

export class AgentSkillLearningRuntime {
  constructor(
    private readonly memory: AgentToolSearchMemory,
    private readonly logger?: AgentLogger,
  ) {}

  learn(draft: AgentSkillLearningEpisodeDraft): void {
    if (draft.activeSkills.length === 0) return;
    const attributedSkills = this.attributeSkills(draft.activeSkills, draft.episode.calls);
    const subjects = draft.activeSkills.map((skill): AgentLearningSubject => ({
      kind: "skill",
      name: skill.name,
      revision: skill.revision,
    }));
    const observation = createAgentLearningEpisode({
      domain: AgentLearningDomains.SkillRouting,
      requestId: draft.requestId,
      sessionId: draft.sessionId,
      rawUserTurn: draft.rawUserTurn,
      standaloneRequest: draft.standaloneRequest,
      contextMode: draft.contextMode,
      contextBasis: draft.contextBasis,
      activeSkills: draft.activeSkills,
      episode: draft.episode,
      subjects,
    });
    this.memory.recordLearningEpisode(observation);

    try {
      this.learnObservedEpisode(observation.id, draft, attributedSkills);
    } catch (error) {
      const message = errorMessage(error);
      this.memory.resolveLearningEpisode(observation.id, {
        state: AgentLearningStates.Failed,
        reason: "Skill routing evidence processing failed",
        error: message,
        updatedAtMs: Date.now(),
      });
      this.logger?.warn("skill.learning.failed", {
        requestId: draft.requestId,
        message,
        episodeId: observation.id,
      });
    }
  }

  private learnObservedEpisode(
    episodeId: string,
    draft: AgentSkillLearningEpisodeDraft,
    attributedSkills: readonly AgentActivatedSkill[],
  ): void {
    const usefulCalls = draft.episode.calls.filter(isGroundedSuccessfulToolSearchCall);
    if (usefulCalls.length === 0) {
      this.skip(episodeId, draft, SkillLearningReasons.NoGroundedOutcome);
      return;
    }
    if (attributedSkills.length === 0) {
      this.skip(episodeId, draft, SkillLearningReasons.AmbiguousAttribution);
      return;
    }
    const termsBySkill = attributedSkills.map((skill) => ({
      skill,
      terms: [...new Set(skill.matchedTerms.map((term) => term.trim()).filter(Boolean))],
    }));
    if (termsBySkill.every(({ terms }) => terms.length === 0)) {
      this.skip(episodeId, draft, SkillLearningReasons.NoTerms);
      return;
    }

    const support = usefulCalls.length / draft.episode.calls.length;
    const learnedAt = Date.now();
    const learnedTerms = termsBySkill.flatMap(({ skill, terms }) =>
      terms.map((term): AgentSkillLearningTermAggregate => ({
        projectId: draft.episode.projectId,
        skillName: skill.name,
        skillRevision: skill.revision,
        term,
        source: "successful_skill_use",
        support,
        weight: support,
        lastSeenAt: learnedAt,
      })),
    );
    this.memory.commitSkillLearning(learnedTerms, episodeId, {
      state: AgentLearningStates.Learned,
      reason: SkillLearningReasons.Learned,
      attempts: 1,
      updatedAtMs: learnedAt,
    });
    this.logger?.info("skill.learning.learned", {
      requestId: draft.requestId,
      skills: attributedSkills.map((skill) => skill.name),
      termCount: learnedTerms.length,
      episodeId,
    });
  }

  private attributeSkills(
    activeSkills: readonly AgentActivatedSkill[],
    calls: readonly AgentToolSearchEpisodeCall[],
  ): AgentActivatedSkill[] {
    const successfulTools = new Set(calls.filter(isGroundedSuccessfulToolSearchCall).map((call) => call.toolName));
    const explicit = activeSkills.filter((skill) =>
      skill.matchedFields.some((field) => field.fields.includes("explicitInvocation")),
    );
    if (explicit.length > 0) return explicit;
    const toolBound = activeSkills.filter((skill) => skill.recommendedTools.some((tool) => successfulTools.has(tool)));
    if (toolBound.length > 0) return toolBound;
    return activeSkills.length === 1 ? [...activeSkills] : [];
  }

  private skip(episodeId: string, draft: AgentSkillLearningEpisodeDraft, reason: string): void {
    this.memory.resolveLearningEpisode(episodeId, {
      state: AgentLearningStates.Skipped,
      reason,
      updatedAtMs: Date.now(),
    });
    this.logger?.info("skill.learning.skipped", {
      requestId: draft.requestId,
      activeSkills: draft.activeSkills.map((skill) => skill.name),
      reason,
      episodeId,
    });
  }
}
