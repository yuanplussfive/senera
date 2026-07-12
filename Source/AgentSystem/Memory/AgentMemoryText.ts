import type { AgentMemoryCandidateDraft, AgentMemoryItemRecord } from "./AgentMemorySourceRepository.js";

export function memoryCandidateEmbeddingText(candidate: AgentMemoryCandidateDraft): string {
  return [
    candidate.type,
    candidate.subject,
    candidate.claim,
    candidate.howToApply,
    candidate.tags.join(" "),
    candidate.triggers.join(" "),
  ].join("\n");
}

export function memoryItemEmbeddingText(item: AgentMemoryItemRecord): string {
  return [item.type, item.subject, item.claim, item.howToApply, item.tags.join(" "), item.triggers.join(" ")].join(
    "\n",
  );
}

export function memoryItemRecallText(item: AgentMemoryItemRecord): string {
  return [item.subject, item.claim, item.howToApply, item.tags.join(" "), item.triggers.join(" ")].join("\n");
}
