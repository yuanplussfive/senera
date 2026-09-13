import type {
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";
import {
  buildAgentContinuityFactPromptWire,
  buildAgentContinuityRulePromptWire,
} from "../ActionPlanner/AgentLearningPromptJson.js";

export const AgentContinuityFactToolName = "ContinuityCapture";
export const AgentContinuityRuleToolName = "ContinuityModels";

const FactNativeProtocol = [
  "Call ContinuityCapture exactly once with shallow items, agenda, and needsRulePass. Do not answer with prose.",
].join("\n");

const RuleNativeProtocol = [
  "Call ContinuityModels exactly once and do not answer with prose. Return one non-empty items list.",
].join("\n");

export function createAgentContinuityFactExtractionContext(
  input: AgentContinuityFactPromptInput,
  stableSystemPrompt: string,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: `${stableSystemPrompt}\n\nNative tool protocol:\n${FactNativeProtocol}`,
    userPrompt: buildAgentContinuityFactPromptWire(input, { stage: "extractContinuityFacts" }),
  };
}

export function createAgentContinuityRuleExtractionContext(
  input: AgentContinuityRulePromptInput,
  stableSystemPrompt: string,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: `${stableSystemPrompt}\n\nNative tool protocol:\n${RuleNativeProtocol}`,
    userPrompt: buildAgentContinuityRulePromptWire(input, { stage: "extractContinuityRules" }),
  };
}
