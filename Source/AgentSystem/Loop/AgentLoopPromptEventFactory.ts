import { summarizePrompt, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { projectAgentContinuitySnapshot } from "../Continuity/AgentContinuitySnapshot.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentPromptHarnessComposition } from "../Prompt/AgentPromptHarness.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";

export class AgentLoopPromptEventFactory {
  promptRendered(
    requestId: string,
    step: number,
    prompt: string,
    tokenCount: number,
    continuityMemory: AgentContinuityMemoryPromptContext,
  ): AgentDomainEvent[] {
    const summary = summarizePrompt(prompt, tokenCount);

    return [
      {
        kind: summary.kind,
        context: { requestId, step },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.ContinuitySnapshot,
        context: { requestId, step },
        data: projectAgentContinuitySnapshot(continuityMemory),
      },
    ];
  }

  promptHarnessComposed(
    requestId: string,
    step: number,
    harness: AgentPromptHarnessComposition,
    mode: AgentModelToolPlanningMode,
    activeSkills: readonly AgentActivatedSkill[],
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.PromptHarnessComposed,
      context: { requestId, step },
      data: {
        profile: mode,
        skills: activeSkills.map((skill) => ({
          name: skill.name,
          revision: skill.revision,
          score: skill.score,
          matchedTerms: [...skill.matchedTerms],
          matchedFields: skill.matchedFields.map((field) => ({ term: field.term, fields: [...field.fields] })),
          recommendedTools: [...skill.recommendedTools],
        })),
        sections: harness.sections,
        merged: harness.merged,
      },
    };
  }
}
