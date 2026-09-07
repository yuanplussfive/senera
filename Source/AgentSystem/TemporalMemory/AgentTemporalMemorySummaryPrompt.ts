import type { AgentTemporalMemorySummaryPromptInput } from "./AgentTemporalMemoryTypes.js";

export const AgentTemporalMemorySummaryToolName = "TemporalMemoryDigest";

const SummaryInstruction = [
  "Summarize one evidence-backed temporal memory period.",
  "Call TemporalMemoryDigest exactly once. Do not answer with prose.",
  "Write the summary and labels in the primary language used by the entries.",
  "Describe what was discussed, decided, completed, changed, or left unresolved; do not narrate storage or tool mechanics.",
  "Preserve concrete people, places, objects, dates, negation, uncertainty, modality, and outcomes.",
  "summary, topics, and openLoops are ordered arrays of text parts. Use {kind: text, text: ...} for prose and {kind: identity, role: user|resident} when referring to a conversation participant.",
  "Keep participant references as identity parts when consolidating child summaries; never encode identity as interpolation syntax, markup, or a display-name guess.",
  "A user statement is evidence that the user said or claimed it, not independent proof that the claim is objectively true.",
  "Assistant text may establish what Senera said or did, but cannot establish an external fact without tool evidence.",
  "For day and month inputs, consolidate repeated child summaries instead of concatenating them.",
  "topics contains concise retrieval labels. openLoops contains only unresolved intentions, questions, or promised follow-up present in the entries.",
  "Do not invent events, identities, relationships, causes, emotions, plans, or completion states.",
  "Do not output source URIs, timestamps, confidence, explanations, markdown, XML, interpolation syntax, or chain-of-thought.",
].join("\n");

export function createAgentTemporalMemorySummaryPrompt(input: AgentTemporalMemorySummaryPromptInput): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  if (input.entries.length === 0) throw new Error("Temporal memory summarization requires evidence entries.");
  return {
    systemPrompt: SummaryInstruction,
    userPrompt: JSON.stringify({ context: input, directive: { stage: "summarizeTemporalMemory" } }, null, 2),
  };
}
