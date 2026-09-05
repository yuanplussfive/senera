import type { AgentConversationBoundaryPromptInput } from "./AgentTemporalMemoryTypes.js";

export const AgentConversationBoundaryToolName = "ConversationBoundary";

const BoundaryInstruction = [
  "Determine whether one completed conversation turn continues the currently open conversation segment.",
  "Call ConversationBoundary exactly once. Do not answer with prose.",
  "Return focus as one short, source-grounded description of the active subject or intention after applying the decision.",
  "For continue, focus updates the open segment focus; for boundary, focus describes only the candidate turn.",
  "Use relation=continue when the candidate answers, clarifies, corrects, elaborates, or naturally advances the same active subject, intention, activity, or unresolved loop.",
  "Use relation=boundary when the candidate begins an independent subject or interaction that should be recalled as a separate conversation episode.",
  "Treat the user message, assistant final response, and tool evidence in a turn as one indivisible event.",
  "Elapsed time and a date change are evidence about continuity, never sufficient reasons by themselves.",
  "Use anchors only to recognize shared durable activities or intentions; they do not force unrelated turns together.",
  "Focus is classification state, not a factual claim or a conversation summary. Do not infer hidden events or explain the decision.",
].join("\n");

export function createAgentConversationBoundaryPrompt(input: AgentConversationBoundaryPromptInput): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  if (input.openSegment.turns.length === 0) {
    throw new Error("Conversation boundary classification requires an open segment with physical turns.");
  }
  return {
    systemPrompt: BoundaryInstruction,
    userPrompt: JSON.stringify({ context: input, directive: { stage: "classifyConversationBoundary" } }, null, 2),
  };
}
