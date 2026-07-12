import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export type AgentTurnUnderstandingEventData = TurnUnderstanding;

export type AgentActivatedSkillEventData = Pick<
  AgentActivatedSkill,
  "name" | "title" | "score" | "matchedTerms" | "matchedFields" | "recommendedTools"
>;
