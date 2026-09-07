import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";

export type AgentActivatedSkillEventData = Pick<
  AgentActivatedSkill,
  "name" | "title" | "score" | "matchedTerms" | "matchedFields" | "recommendedTools"
>;
