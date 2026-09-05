import type { AgentTemporalMemorySummaryPromptInput } from "./AgentTemporalMemoryTypes.js";

export const AgentTemporalMemorySummaryToolName = "TemporalMemoryDigest";

const SummaryInstruction = [
  "Summarize one evidence-backed temporal memory period.",
  "Call TemporalMemoryDigest exactly once. Do not answer with prose.",
  "Write the summary and labels in the primary language used by the entries.",
  "Describe what was discussed, decided, completed, changed, or left unresolved; do not narrate storage or tool mechanics.",
  "Preserve concrete people, places, objects, dates, negation, uncertainty, modality, and outcomes.",
  "When referring to the conversation participants, write the literal placeholders {{user}} and {{resident}} instead of display names. Preserve these placeholders when consolidating child summaries.",
  "{{user}} means the user and {{resident}} means the resident persona speaking in the conversation. Do not use {{bot}}, Liquid tags, filters, or any other variables.",
  "A user statement is evidence that the user said or claimed it, not independent proof that the claim is objectively true.",
  "Assistant text may establish what Senera said or did, but cannot establish an external fact without tool evidence.",
  "For day and month inputs, consolidate repeated child summaries instead of concatenating them.",
  "topics contains concise retrieval labels. openLoops contains only unresolved intentions, questions, or promised follow-up present in the entries.",
  "Do not invent events, identities, relationships, causes, emotions, plans, or completion states.",
  "Do not output source URIs, timestamps, confidence, explanations, markdown, XML, or chain-of-thought.",
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
